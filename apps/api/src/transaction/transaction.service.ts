import { Injectable, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  TransactionLog,
  TRANSACTION_QUEUE,
  TransactionJobData,
  TransactionIntent,
  TokenMetadata,
} from '@copil/database';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { ChainAbstractionClient, AssetBalance } from '@copil/chain-abstraction-client';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);
  private readonly quoteCache = new Map<string, { t: number; data: any }>();

  constructor(
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
    @InjectRepository(TokenMetadata)
    private readonly tokenMetadataRepository: Repository<TokenMetadata>,
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly transactionQueue: Queue<TransactionJobData>,
    private readonly chainAbstractionClient: ChainAbstractionClient,
    private readonly portfolioService: PortfolioService, // Injected PortfolioService
    private readonly configService: ConfigService,
  ) {}

  async getQuote(intent: TransactionIntent) {
    const cacheTtl = parseInt(this.configService.get<string>('QUOTE_CACHE_TTL_MS') || '15000', 10);
    const cacheKey = this.buildCacheKey('onebalance', intent);
    const cached = this.readCache(cacheKey, cacheTtl);
    if (cached) return cached;
    // Sanitize/normalize incoming intent fields
    intent = await this.sanitizeIntent(intent);
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
    this.writeCache(cacheKey, quote);
    return quote;
  }

  private ensureChainsSupported(intent: TransactionIntent) {
    const evmExecutable = new Set(['ethereum', 'base', 'arbitrum', 'linea', 'optimism', 'polygon', 'bsc', 'avalanche', 'hyperevm']);
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
    recommendation?: { provider: string; executable: boolean; reason: string; estToAmount?: string };
    explain?: string;
  }> {
    const ob = await this.getQuote(intent)
      .then((q) => ({ supported: true, quote: q }))
      .catch((e) => ({ supported: false, error: (e as Error).message }));

    const lifiCacheKey = this.buildCacheKey('lifi', intent);
    const lifiCached = this.readCache(lifiCacheKey, parseInt(this.configService.get<string>('QUOTE_CACHE_TTL_MS') || '15000', 10));
    const lifi = lifiCached ?? (await this.chainAbstractionClient.getLiFiQuoteForIntent(intent).catch((e) => ({ supported: false, error: (e as Error).message })));
    if (!lifiCached) this.writeCache(lifiCacheKey, lifi);
    const rec = this.makeRecommendation(ob, lifi);
    return { onebalance: ob, lifi, recommendation: rec.recommendation, explain: rec.explain };
  }

  private makeRecommendation(
    ob: { supported: boolean; quote?: any; error?: string },
    lifi: { supported: boolean; raw?: any; error?: string; transactionRequest?: any },
  ): { recommendation?: { provider: string; executable: boolean; reason: string; estToAmount?: string }; explain?: string } {
    const isExecutable = (q: any) => Boolean(q && typeof q.transactionRequest?.to === 'string' && q.transactionRequest?.to.startsWith('0x'));
    // Prefer OneBalance when executable
    if (ob.supported && ob.quote && isExecutable(ob.quote)) {
      return {
        recommendation: { provider: 'onebalance', executable: true, reason: 'Non-custodial route with executable transactionRequest', estToAmount: ob.quote?.toAmount },
        explain: 'OneBalance provides an executable tx for your wallet. Fewer steps and non-custodial.',
      };
    }
    // Fallback to LiFi if it has an executable tx
    if (lifi.supported && isExecutable({ transactionRequest: lifi.transactionRequest })) {
      return {
        recommendation: { provider: 'lifi', executable: true, reason: 'OneBalance not executable; LiFi fallback available', estToAmount: undefined },
        explain: 'LiFi offers a viable route. Review details before signing.',
      };
    }
    // No executable routes
    return {
      recommendation: { provider: 'none', executable: false, reason: ob.error ?? lifi.error ?? 'No executable route found' },
      explain: 'No non-custodial route with a ready transaction. Adjust parameters or try later.',
    };
  }

  async createAdHocTransactionJob(
    userId: number,
    sessionKeyId: number,
    intent: TransactionIntent,
    idempotencyKey?: string,
  ): Promise<TransactionJobData> {
    // Concurrency guard per user
    const maxActive = parseInt(this.configService.get<string>('TX_MAX_ACTIVE_JOBS_PER_USER') || '3', 10);
    const activeCount = await this.countUserJobs(userId);
    if (activeCount >= maxActive) {
      throw new HttpException(
        `You have ${activeCount} active jobs; limit is ${maxActive}. Please wait before enqueuing new transactions.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Idempotency: if key provided and an existing job is present, return its data
    if (idempotencyKey) {
      const existing = await this.findExistingJob(userId, idempotencyKey);
      if (existing) {
        this.logger.log(`Idempotency hit for user ${userId}, key ${idempotencyKey}; returning existing job data.`);
        return existing.data as TransactionJobData;
      }
    }
    let finalIntent = { ...(await this.sanitizeIntent(intent)) };

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
        ...(idempotencyKey ? { idempotencyKey } : {}),
      },
    };

    const jobName = `ad-hoc:user:${userId}`;
    const jobId = idempotencyKey ? `user:${userId}:idem:${idempotencyKey}` : undefined;
    const job = await this.transactionQueue.add(jobName, jobData, {
      ...(jobId ? { jobId } : {}),
      removeOnComplete: 100,
      removeOnFail: 500,
    });

    this.logger.log(
      `Enqueued ad-hoc transaction job ${job.id} for user ${userId}`,
    );

    return job.data;
  }

  private async countUserJobs(userId: number): Promise<number> {
    const states: any = ['waiting', 'delayed', 'active'];
    // Fetch a reasonable window of jobs
    const jobs = await this.transactionQueue.getJobs(states, 0, 500);
    return jobs.filter((j) => (j?.data as any)?.userId === userId).length;
  }

  private async findExistingJob(userId: number, idempotencyKey: string) {
    const states: any = ['waiting', 'delayed', 'active'];
    const jobs = await this.transactionQueue.getJobs(states, 0, 500);
    return jobs.find((j) => {
      const d = (j?.data as any) ?? {};
      return d.userId === userId && d?.metadata?.idempotencyKey === idempotencyKey;
    });
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

  private buildCacheKey(provider: 'onebalance' | 'lifi', intent: TransactionIntent): string {
    const { type } = intent;
    if (type === 'custom') return `${provider}:custom:${intent.name}`;
    const parts = [
      provider,
      type,
      intent.fromChain,
      intent.toChain,
      intent.fromToken,
      intent.toToken,
      intent.fromAmount,
      intent.userAddress,
      (intent as any).destinationAddress ?? '',
      String((intent as any).slippageBps ?? ''),
    ];
    return parts.join('|');
  }

  private readCache<T = any>(key: string, ttlMs: number): T | null {
    const hit = this.quoteCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      this.quoteCache.delete(key);
      return null;
    }
    return hit.data as T;
  }

  private writeCache(key: string, data: any) {
    this.quoteCache.set(key, { t: Date.now(), data });
  }

  private async sanitizeIntent(intent: TransactionIntent): Promise<TransactionIntent> {
    if (intent.type === 'custom') return intent;
    const normalizeToken = async (chain: string, token: string): Promise<string> => {
      if (typeof token !== 'string') return token as any;
      if (/^0x[0-9a-fA-F]{40}$/.test(token)) return token.toLowerCase();
      // If token looks like 0x* but wrong case, try lowering when metadata exists
      if (token.startsWith('0x') && token.length === 42) {
        const lower = token.toLowerCase();
        try {
          const meta = await this.tokenMetadataRepository.findOne({ where: { chain: chain.toLowerCase(), address: lower } });
          if (meta) return lower;
        } catch {}
      }
      return token;
    };
    const fromToken = await normalizeToken(intent.fromChain, intent.fromToken);
    const toToken = await normalizeToken(intent.toChain, intent.toToken);
    const slippage = (intent as any).slippageBps;
    const slippageClamped = typeof slippage === 'number' ? Math.max(1, Math.min(slippage, 1000)) : undefined;
    return { ...intent, fromToken, toToken, ...(slippageClamped ? { slippageBps: slippageClamped } : {}) } as any;
  }
}
