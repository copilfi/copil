import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, Process } from '@nestjs/bull';
import { Job, Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Strategy,
  StrategyDefinition,
  TokenPrice,
  TransactionJobData,
  STRATEGY_QUEUE,
  TRANSACTION_QUEUE,
} from '@copil/database';

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
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly transactionQueue: Queue<TransactionJobData>,
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

    // Simple price trigger evaluation logic
    const definition = strategy.definition as StrategyDefinition;
    if (definition.trigger.type === 'price') {
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
        return;
      }

      this.logger.debug(
        `Latest price for ${latestPrice.symbol}: ${latestPrice.priceUsd}, target: ${definition.trigger.priceTarget}`,
      );

      const comparator = definition.trigger.comparator ?? 'gte';
      const conditionMet =
        comparator === 'gte'
          ? latestPrice.priceUsd >= definition.trigger.priceTarget
          : latestPrice.priceUsd <= definition.trigger.priceTarget;

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

  private async enqueueTransaction(strategy: Strategy, definition: StrategyDefinition) {
    const payload: TransactionJobData = {
      strategyId: strategy.id,
      userId: strategy.userId,
      action: definition.action,
      sessionKeyId: definition.sessionKeyId,
      metadata: {
        trigger: definition.trigger,
        enqueuedAt: new Date().toISOString(),
      },
    };

    await this.transactionQueue.add(
      `strategy:${strategy.id}:execution`,
      payload,
      {
        removeOnComplete: 100,
        removeOnFail: false,
        attempts: TRANSACTION_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: TRANSACTION_JOB_BACKOFF_MS,
        },
      },
    );
  }
}
