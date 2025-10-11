import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy, TokenPrice } from '@copil/database';

@Processor('strategy-queue')
export class StrategyProcessor {
  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
  ) {}

  @Process('*') // Process all job types in this queue
  async handleStrategy(job: Job<any>) {
    console.log(`[StrategyEvaluator] Processing job: ${job.id}, name: ${job.name}`);
    const strategy = await this.strategyRepository.findOne({ where: { id: job.data.strategyId } });

    if (!strategy || !strategy.isActive) {
      console.log(`[StrategyEvaluator] Strategy ${job.data.strategyId} not found or is inactive. Skipping.`);
      return;
    }

    console.log(`[StrategyEvaluator] Evaluating strategy: ${strategy.name}`);

    // Simple price trigger evaluation logic
    const definition = strategy.definition as any;
    if (definition.type === 'price') {
      const latestPrice = await this.tokenPriceRepository.findOne({
        where: { chain: definition.chain, address: definition.tokenAddress },
        order: { timestamp: 'DESC' },
      });

      if (!latestPrice) {
        console.log(`[StrategyEvaluator] No price data found for ${definition.tokenAddress} on ${definition.chain}.`);
        return;
      }

      console.log(`[StrategyEvaluator] Latest price for ${latestPrice.symbol}: ${latestPrice.priceUsd}, Target: ${definition.priceTarget}`);

      if (latestPrice.priceUsd >= definition.priceTarget) {
        console.log(`[StrategyEvaluator] TRIGGER MET! Strategy: ${strategy.name}`);
        // TODO: Execute the action (e.g., create a transaction job)
        // For now, we can deactivate the strategy to prevent re-triggering
        strategy.isActive = false;
        await this.strategyRepository.save(strategy);
        console.log(`[StrategyEvaluator] Strategy ${strategy.name} deactivated after triggering.`);
      }
    }
  }
}
