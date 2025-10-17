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
  ) {
    this.apiServiceUrl = this.configService.get<string>('API_SERVICE_URL', 'http://localhost:3001');
  }

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
          `Strategy ${strategy.id} missing sessionKeyId. Cannot trigger transaction execution.`,
        );
        return;
      }

      this.logger.log(`Trigger met for strategy ${strategy.name} (${strategy.id}). Triggering execution.`);
      await this.triggerExecution(strategy, definition);

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

  private async triggerExecution(strategy: Strategy, definition: StrategyDefinition) {
    const payload = {
      intent: definition.intent,
      sessionKeyId: definition.sessionKeyId,
    };

    try {
      this.logger.log(`Calling API service to execute transaction for strategy ${strategy.id}`);
      const endpoint = `${this.apiServiceUrl}/transaction/execute`;
      // We don't need to pass the user ID, as the API service will resolve it from the session key
      // or we might need a service account token for this internal call.
      // For now, we assume the endpoint is protected and requires some auth.
      // This is a placeholder for the actual authenticated call.
      await firstValueFrom(this.httpService.post(endpoint, payload));
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