import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import axios from 'axios';
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
  }

  @Process('*') // Process all job types in this queue
  async handleStrategy(job: Job<{ strategyId: number }>) {
    this.logger.debug(`Processing job: ${job.id}, name: ${job.name}`);

    // Concurrency guard: if there is another active job for the same strategy, skip
    try {
      const activeJobs: any[] = await this.strategyQueue.getJobs(['active'], 0, 500);
      const hasOtherActive = activeJobs.some((j) => j?.id !== job.id && j?.data?.strategyId === job.data.strategyId);
      if (hasOtherActive) {
        this.logger.warn(`Strategy ${job.data.strategyId} already has an active job. Skipping overlapping execution.`);
        return;
      }
    } catch {}
    const strategy = await this.strategyRepository.findOne({ where: { id: job.data.strategyId } });

    if (!strategy || !strategy.isActive) {
      this.logger.warn(`Strategy ${job.data.strategyId} not found or inactive. Skipping.`);
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
    const inTop = unique.some((x) => x.chain.toLowerCase() === chain && x.address.toLowerCase() === token);
    this.logger.debug(`Trend trigger check on ${chain} ${token}: inTop=${inTop} (top=${top})`);
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
      if (token) headers['x-service-token'] = token;
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
}
