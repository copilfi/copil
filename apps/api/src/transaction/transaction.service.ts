import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  TransactionLog,
  TRANSACTION_QUEUE,
  TransactionJobData,
  TransactionIntent,
} from '@copil/database';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { ChainAbstractionClient, AssetBalance } from '@copil/chain-abstraction-client';
import { PortfolioService } from '../portfolio/portfolio.service';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly transactionQueue: Queue<TransactionJobData>,
    private readonly chainAbstractionClient: ChainAbstractionClient,
    private readonly portfolioService: PortfolioService, // Injected PortfolioService
  ) {}

  async getQuote(intent: TransactionIntent) {
    // Validate chain support before attempting to quote to avoid non-executable routes
    this.ensureChainsSupported(intent);
    const quoteResponse = await this.chainAbstractionClient.getQuote({ intent });
    const quote = quoteResponse.quote as any;

    // Non-custodial guard: require an executable transactionRequest
    const tx = quote?.transactionRequest;
    const validTx = tx && typeof tx.to === 'string' && tx.to.startsWith('0x') && typeof tx.data === 'string' && tx.data.startsWith('0x');
    if (!validTx) {
      throw new BadRequestException(
        'Quote is not executable with a local signature. Only non-custodial transaction requests are supported.',
      );
    }
    return quote;
  }

  private ensureChainsSupported(intent: TransactionIntent) {
    const evmExecutable = new Set(['ethereum', 'base', 'arbitrum', 'linea', 'optimism', 'polygon', 'bsc', 'avalanche']);
    const isSei = (c?: string) => (c ?? '').toLowerCase() === 'sei';

    const from = (intent as any).fromChain?.toLowerCase?.() as string | undefined;
    const to = (intent as any).toChain?.toLowerCase?.() as string | undefined;

    // swap intents must execute on the source chain
    if (intent.type === 'swap') {
      if (isSei(from)) return; // Sei swap handled by Sei client
      if (!from || !evmExecutable.has(from)) {
        throw new BadRequestException(
          `Unsupported source chain for execution: ${from ?? 'unknown'}. Supported: ${Array.from(evmExecutable).join(', ')}, plus 'sei' (native).`,
        );
      }
      return;
    }

    // bridge intents: allow EVM<->EVM via OneBalance (limited to configured EVMs) and EVM<->Sei via Axelar
    if (intent.type === 'bridge') {
      const fromOk = from && (evmExecutable.has(from) || isSei(from));
      const toOk = to && (evmExecutable.has(to) || isSei(to));
      if (!fromOk || !toOk) {
        throw new BadRequestException(
          `Unsupported bridge path (${from} -> ${to}). Supported EVMs: ${Array.from(evmExecutable).join(', ')}, and 'sei' via Axelar.`,
        );
      }
      // For Sei paths, require the other side to be one of our EVMs
      if (isSei(from) || isSei(to)) {
        const other = isSei(from) ? to : from;
        if (!other || !evmExecutable.has(other)) {
          throw new BadRequestException(
            `For Sei bridges, the EVM side must be one of: ${Array.from(evmExecutable).join(', ')}.`,
          );
        }
      }
      return;
    }

    // default guard
    throw new BadRequestException(`Unsupported intent type: ${intent.type}`);
  }

  async getLogs(userId: number, limit = 20): Promise<TransactionLog[]> {
    return this.transactionLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async compareQuotes(intent: TransactionIntent): Promise<{
    onebalance: { supported: boolean; quote?: any; error?: string };
    lifi: { supported: boolean; raw?: any; error?: string; transactionRequest?: any };
  }> {
    const ob = await this.getQuote(intent)
      .then((q) => ({ supported: true, quote: q }))
      .catch((e) => ({ supported: false, error: (e as Error).message }));

    const lifi = await this.chainAbstractionClient.getLiFiQuoteForIntent(intent);
    return { onebalance: ob, lifi };
  }

  async createAdHocTransactionJob(
    userId: number,
    sessionKeyId: number,
    intent: TransactionIntent,
  ): Promise<TransactionJobData> {
    let finalIntent = { ...intent };

    // Handle percentage-based amounts if needed
    if (finalIntent.type === 'swap' || finalIntent.type === 'bridge') {
      if ((finalIntent as any).amountInIsPercentage) {
        const absoluteAmount = await this.calculateAbsoluteAmount(
          userId,
          finalIntent.fromChain,
          finalIntent.fromToken,
          parseFloat(finalIntent.fromAmount),
        );

        if (!absoluteAmount) {
          throw new BadRequestException(
            `Could not calculate absolute amount for ${finalIntent.fromToken} on chain ${finalIntent.fromChain}. Check if you have a balance.`,
          );
        }

        finalIntent.fromAmount = absoluteAmount;
      }
    }

    // First, get a quote for the intended transaction
    const quote = await this.getQuote(finalIntent);

    const jobData: TransactionJobData = {
      strategyId: null, // Explicitly set strategyId to null for ad-hoc jobs
      userId,
      sessionKeyId,
      intent: finalIntent,
      quote, // Pass the entire quote object to the executor
      metadata: {
        source: 'ad-hoc',
        enqueuedAt: new Date().toISOString(),
      },
    };

    const job = await this.transactionQueue.add(`ad-hoc:user:${userId}`, jobData, {
      removeOnComplete: 100,
      removeOnFail: 500,
    });

    this.logger.log(
      `Enqueued ad-hoc transaction job ${job.id} for user ${userId}`,
    );

    return job.data;
  }

  private async calculateAbsoluteAmount(
    userId: number,
    chain: string,
    tokenAddress: string,
    percentage: number,
  ): Promise<string | null> {
    const portfolio = (await this.portfolioService.getPortfolioForUser(
      userId,
    )) as AssetBalance[];

    const token = portfolio.find(
      (b) =>
        b.assetId.toLowerCase().includes(tokenAddress.toLowerCase()) &&
        b.assetId.toLowerCase().includes(chain.toLowerCase()),
    );

    if (!token || !token.amount) {
      this.logger.warn(`No balance found for token ${tokenAddress} for user ${userId} on chain ${chain}.`);
      return null;
    }

    const balance = BigInt(token.amount);
    const amountToSell = (balance * BigInt(percentage)) / BigInt(100);

    this.logger.log(`Calculated ${percentage}% of balance for ${tokenAddress}: ${amountToSell.toString()}`);
    return amountToSell.toString();
  }
}
