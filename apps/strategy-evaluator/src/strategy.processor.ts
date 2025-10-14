import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, Process } from '@nestjs/bull';
import { Job, Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Strategy,
  StrategyDefinition,
  TokenPrice,
  TransactionAction,
  TransactionJobData,
  Wallet,
  STRATEGY_QUEUE,
  TRANSACTION_QUEUE,
} from '@copil/database';
import { AlchemyService } from './alchemy.service';
import { Network, Utils } from 'alchemy-sdk';

const TRANSACTION_JOB_ATTEMPTS = 3;
const TRANSACTION_JOB_BACKOFF_MS = 60_000;

@Processor(STRATEGY_QUEUE)
export class StrategyProcessor {
  private readonly logger = new Logger(StrategyProcessor.name);

  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly transactionQueue: Queue<TransactionJobData>,
    private readonly alchemyService: AlchemyService,
  ) {}

  @Process('*') // Process all job types in this queue
  async handleStrategy(job: Job<{ strategyId: number }>) {
    this.logger.debug(`Processing job: ${job.id}, name: ${job.name}`);
    const strategy = await this.strategyRepository.findOne({ where: { id: job.data.strategyId } });

    if (!strategy || !strategy.isActive) {
      this.logger.warn(`Strategy ${job.data.strategyId} not found or inactive. Skipping.`);
      return;
    }

    this.logger.debug(`Evaluating strategy: ${strategy.name}`);

    const definition = strategy.definition as StrategyDefinition;
    if (definition.trigger.type === 'price') {
      const conditionMet = await this.evaluatePriceTrigger(definition);
      if (!conditionMet) {
        this.logger.debug(`Trigger condition not met for strategy ${strategy.id}.`);
        return;
      }

      if (!definition.sessionKeyId) {
        this.logger.warn(
          `Strategy ${strategy.id} missing sessionKeyId. Cannot enqueue transaction job.`,
        );
        return;
      }

      this.logger.log(`Trigger met for strategy ${strategy.name} (${strategy.id}). Enqueuing action.`);
      await this.enqueueTransaction(strategy, definition);

      if (!definition.repeat) {
        strategy.isActive = false;
        await this.strategyRepository.save(strategy);
        this.logger.log(`Strategy ${strategy.name} deactivated after execution.`);
      }
    }
  }

  private async evaluatePriceTrigger(definition: StrategyDefinition): Promise<boolean> {
    if (definition.trigger.type !== 'price') return false;

    const latestPrice = await this.tokenPriceRepository.findOne({
      where: {
        chain: definition.trigger.chain,
        address: definition.trigger.tokenAddress,
      },
      order: { timestamp: 'DESC' },
    });

    if (!latestPrice) {
      this.logger.warn(
        `No price data for ${definition.trigger.tokenAddress} on ${definition.trigger.chain}.`,
      );
      return false;
    }

    this.logger.debug(
      `Latest price for ${latestPrice.symbol}: ${latestPrice.priceUsd}, target: ${definition.trigger.priceTarget}`,
    );

    const comparator = definition.trigger.comparator ?? 'gte';
    return comparator === 'gte'
      ? latestPrice.priceUsd >= definition.trigger.priceTarget
      : latestPrice.priceUsd <= definition.trigger.priceTarget;
  }

  private async enqueueTransaction(strategy: Strategy, definition: StrategyDefinition) {
    let finalAction = definition.action;

    // Handle percentage-based amounts
    if (finalAction.type === 'swap' && finalAction.amountInIsPercentage) {
        const absoluteAmount = await this.calculateAbsoluteAmount(
            strategy.userId,
            finalAction.chainId,
            finalAction.assetIn,
            parseFloat(finalAction.amountIn),
        );

        if (!absoluteAmount) {
            this.logger.error(`Could not calculate absolute amount for strategy ${strategy.id}. Skipping.`);
            return;
        }

        finalAction = {
            ...finalAction,
            amountIn: absoluteAmount,
            amountInIsPercentage: false, // Ensure the job has an absolute value
        };
    }

    const payload: TransactionJobData = {
      strategyId: strategy.id,
      userId: strategy.userId,
      action: finalAction,
      sessionKeyId: definition.sessionKeyId,
      metadata: {
        trigger: definition.trigger,
        enqueuedAt: new Date().toISOString(),
      },
    };

    await this.transactionQueue.add(`strategy:${strategy.id}:execution`, payload, {
      removeOnComplete: 100,
      removeOnFail: false,
      attempts: TRANSACTION_JOB_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: TRANSACTION_JOB_BACKOFF_MS,
      },
    });
  }

  private async calculateAbsoluteAmount(
    userId: number,
    chain: string,
    tokenAddress: string,
    percentage: number,
  ): Promise<string | null> {
    const wallet = await this.walletRepository.findOne({ where: { userId, chain } });
    if (!wallet) {
      this.logger.warn(`No wallet found for user ${userId} on chain ${chain}.`);
      return null;
    }

    const network = this.getNetworkEnum(chain);
    if (!network) {
        this.logger.warn(`Unsupported chain for balance check: ${chain}.`);
        return null;
    }

    const sdk = this.alchemyService.getSdkForNetwork(network);
    const balances = await sdk.core.getTokenBalances(wallet.address, [tokenAddress]);
    const tokenBalance = balances.tokenBalances[0];

    if (!tokenBalance || !tokenBalance.tokenBalance) {
        this.logger.warn(`No balance found for token ${tokenAddress} on wallet ${wallet.address}.`);
        return null;
    }

    const balance = BigInt(tokenBalance.tokenBalance);
    const amountToSell = (balance * BigInt(percentage)) / BigInt(100);

    this.logger.log(`Calculated ${percentage}% of balance for ${tokenAddress}: ${amountToSell.toString()}`);
    return amountToSell.toString();
  }

  private getNetworkEnum(chain: string): Network | null {
    switch (chain.toLowerCase()) {
      case 'ethereum': return Network.ETH_MAINNET;
      case 'base': return Network.BASE_MAINNET;
      case 'arbitrum': return Network.ARB_MAINNET;
      case 'linea': return Network.LINEA_MAINNET;
      default: return null;
    }
  }
}