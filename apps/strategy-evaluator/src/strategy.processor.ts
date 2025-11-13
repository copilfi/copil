import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import axios from 'axios';
import { createHmac } from 'crypto';
import Redis from 'ioredis';
import {
  Strategy,
  StrategyDefinition,
  TokenPrice,
  STRATEGY_QUEUE,
} from '@copil/database';

@Processor(STRATEGY_QUEUE)
export class StrategyProcessor {
  private readonly logger = new Logger(StrategyProcessor.name);
  private readonly apiServiceUrl: string;
  private readonly PRICE_STALENESS_MS = 5 * 60 * 1000;
  private readonly MAX_TWAP_DEVIATION_PERCENT = 30;
  private readonly TWAP_WINDOW_MS = 60 * 60 * 1000;
  private readonly lockClient: Redis;

  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectQueue(STRATEGY_QUEUE) private readonly strategyQueue: any,
  ) {
    this.apiServiceUrl = this.configService.get<string>('API_SERVICE_URL', 'http://localhost:4311');
    this.lockClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: parseInt(this.configService.get<string>('REDIS_PORT') || '6379', 10),
      maxRetriesPerRequest: 2,
    });
  }

  @Process('*') // Process all job types in this queue
  async handleStrategy(job: Job<{ strategyId: number }>) {
    this.logger.debug(`Processing job: ${job.id}, name: ${job.name}`);

    const strategyId = job.data.strategyId;
    const lockKey = `strategy-lock:${strategyId}`;
    const lockToken = await this.acquireLock(lockKey, 30_000);
    if (!lockToken) {
      this.logger.warn(`Strategy ${strategyId} already locked. Skipping job ${job.id}.`);
      return;
    }

    try {
      // Concurrency guard: if there is another active job for the same strategy, skip
      try {
        const activeJobs: any[] = await this.strategyQueue.getJobs(['active'], 0, 500);
        const hasOtherActive = activeJobs.some((j) => j?.id !== job.id && j?.data?.strategyId === strategyId);
        if (hasOtherActive) {
          this.logger.warn(`Strategy ${strategyId} already has an active job. Skipping overlapping execution.`);
          return;
        }
      } catch {}
      const strategy = await this.strategyRepository.findOne({ where: { id: strategyId } });

      if (!strategy || !strategy.isActive) {
        this.logger.warn(`Strategy ${strategyId} not found or inactive. Skipping.`);
        return;
      }

      this.logger.debug(`Evaluating strategy: ${strategy.name}`);

      const definition = strategy.definition as StrategyDefinition;
      if (definition.trigger.type === 'price' || definition.trigger.type === 'trend') {
        const conditionMet = definition.trigger.type === 'price'
          ? await this.evaluatePriceTrigger(definition)
          : await this.evaluateTrendTrigger(definition);
        if (!conditionMet) {
          this.logger.debug(`Trigger condition not met for strategy ${strategy.id}.`);
          return;
        }

        if (!definition.sessionKeyId) {
          this.logger.warn(
            `Strategy ${strategy.id} missing sessionKeyId. Cannot trigger transaction execution.`,
          );
          return;
        }

        this.logger.log(`Trigger met for strategy ${strategy.name} (${strategy.id}). Triggering execution.`);
        await this.triggerExecution(strategy, definition, job.id as string);

        if (!definition.repeat) {
          strategy.isActive = false;
          await this.strategyRepository.save(strategy);
          this.logger.log(`Strategy ${strategy.name} deactivated after execution.`);
        }
      }
    } finally {
      await this.releaseLock(lockKey, lockToken);
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
      this.logger.warn(`Price trigger not met: no TokenPrice data for ${definition.trigger.tokenAddress} on ${definition.trigger.chain}.`);
      return false;
    }

    const priceGuard = await this.validatePriceData(definition.trigger.chain, definition.trigger.tokenAddress);
    if (!priceGuard.ok) {
      this.logger.warn(`Price data rejected for ${definition.trigger.chain}:${definition.trigger.tokenAddress} - ${priceGuard.reason}`);
      return false;
    }

    this.logger.debug(
      `Latest price for ${latestPrice.symbol}: ${priceGuard.price}, target: ${definition.trigger.priceTarget}`,
    );

    const comparator = definition.trigger.comparator ?? 'gte';
    const currentPrice = priceGuard.price ?? Number(latestPrice.priceUsd);
    const met = comparator === 'gte'
      ? currentPrice >= definition.trigger.priceTarget
      : currentPrice <= definition.trigger.priceTarget;
    if (!met) {
      this.logger.debug(`Price trigger not met: latest=${latestPrice.priceUsd} comparator=${comparator} target=${definition.trigger.priceTarget}`);
    }
    return met;
  }

  private async evaluateTrendTrigger(definition: StrategyDefinition): Promise<boolean> {
    if (definition.trigger.type !== 'trend') return false;
    const chain = definition.trigger.chain.toLowerCase();
    const token = definition.trigger.tokenAddress.toLowerCase();
    const top = Math.max(1, Math.min(definition.trigger.top ?? 10, 50));

    // Fetch a recent window of TokenPrice rows and dedupe by (chain,address) similar to MarketService
    const rows = await this.tokenPriceRepository.find({ where: { chain }, order: { timestamp: 'DESC' }, take: Math.max(top * 10, 100) });
    const seen = new Set<string>();
    const unique: Array<{ chain: string; address: string }> = [];
    for (const r of rows) {
      const key = `${r.chain.toLowerCase()}|${r.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ chain: r.chain, address: r.address });
      if (unique.length >= top) break;
    }
    const idx = unique.findIndex((x) => x.chain.toLowerCase() === chain && x.address.toLowerCase() === token);
    const inTop = idx >= 0;
    if (!inTop) {
      this.logger.debug(`Trend trigger not met on ${chain} ${token}: not within top ${top}.`);
    } else {
      this.logger.debug(`Trend trigger met on ${chain} ${token}: rank=${idx + 1} within top ${top}.`);
    }
    return inTop;
  }

  private async triggerExecution(strategy: Strategy, definition: StrategyDefinition, jobId: string) {
      const payload = {
        userId: strategy.userId,
        intent: definition.intent,
        sessionKeyId: definition.sessionKeyId,
        idempotencyKey: `strategy:${strategy.id}:job:${jobId}`,
      } as const;

    try {
      this.logger.log(`Calling API service to execute transaction for strategy ${strategy.id}`);
      const endpoint = `${this.apiServiceUrl}/transaction/execute/internal`;
      // We don't need to pass the user ID, as the API service will resolve it from the session key
      // or we might need a service account token for this internal call.
      // For now, we assume the endpoint is protected and requires some auth.
      // This is a placeholder for the actual authenticated call.
      const headers: Record<string, string> = {};
      const token = this.configService.get<string>('INTERNAL_API_TOKEN');
      if (token) {
        headers['x-service-token'] = token;
        const timestamp = Date.now().toString();
        const payloadString = JSON.stringify(payload);
        headers['x-service-timestamp'] = timestamp;
        headers['x-service-signature'] = createHmac('sha256', token)
          .update(`${timestamp}:${payloadString}`)
          .digest('hex');
      }
      // Basic retry with exponential backoff
      const attempts = Number(this.configService.get<string>('EVALUATOR_EXECUTE_MAX_RETRIES') ?? '3');
      const baseDelay = Number(this.configService.get<string>('EVALUATOR_EXECUTE_BACKOFF_MS') ?? '500');
      let lastErr: any;
      for (let i = 0; i < attempts; i++) {
        try {
          await firstValueFrom(this.httpService.post(endpoint, payload, { headers }));
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const delay = baseDelay * Math.pow(2, i);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      if (lastErr) throw lastErr;
      this.logger.log(`Successfully triggered execution for strategy ${strategy.id}`);
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (axios.isAxiosError(error)) {
        errorMessage = error.response?.data?.message ?? error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.logger.error(
        `Failed to trigger execution for strategy ${strategy.id} via API call: ${errorMessage}`,
      );
      // Optionally, handle retry logic or mark the strategy as failed
    }
  }

  private async validatePriceData(chain: string, tokenAddress: string): Promise<{ ok: boolean; price?: number; reason?: string }> {
    const latest = await this.tokenPriceRepository.findOne({
      where: {
        chain: chain.toLowerCase(),
        address: tokenAddress.toLowerCase(),
      },
      order: { timestamp: 'DESC' },
    });

    if (!latest) {
      return { ok: false, reason: 'No price data' };
    }

    const ageMs = Date.now() - new Date(latest.timestamp).getTime();
    if (ageMs > this.PRICE_STALENESS_MS) {
      return { ok: false, reason: `Price data stale (${Math.floor(ageMs / 1000)}s old)` };
    }

    const currentPrice = Number(latest.priceUsd);
    const twap = await this.calculateTwap(chain, tokenAddress, this.TWAP_WINDOW_MS);
    if (twap !== null) {
      const deviation = Math.abs((currentPrice - twap) / twap) * 100;
      if (deviation > this.MAX_TWAP_DEVIATION_PERCENT) {
        return { ok: false, reason: `Price deviates ${deviation.toFixed(2)}% from TWAP` };
      }
    }

    return { ok: true, price: currentPrice };
  }

  private async calculateTwap(chain: string, tokenAddress: string, windowMs: number): Promise<number | null> {
    const since = new Date(Date.now() - windowMs);
    const rows = await this.tokenPriceRepository.find({
      where: {
        chain: chain.toLowerCase(),
        address: tokenAddress.toLowerCase(),
        timestamp: MoreThan(since),
      },
      order: { timestamp: 'ASC' },
      take: 100,
    });

    if (rows.length < 3) {
      return null;
    }

    let totalWeighted = 0;
    let totalWeight = 0;
    for (let i = 0; i < rows.length; i++) {
      const current = rows[i];
      const nextTs = rows[i + 1]?.timestamp ?? new Date();
      const weight = new Date(nextTs).getTime() - new Date(current.timestamp).getTime();
      if (weight <= 0) continue;
      totalWeighted += Number(current.priceUsd) * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return null;
    }

    return totalWeighted / totalWeight;
  }

  private async acquireLock(key: string, ttlMs = 30_000): Promise<string | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const result = await this.lockClient.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
      return result === 'OK' ? token : null;
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.lockClient.eval(script, 1, `lock:${key}`, token);
    } catch (error) {
      this.logger.warn(`Failed to release lock ${key}: ${(error as Error).message}`);
    }
  }
}
