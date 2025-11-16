import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceSource, TWAPResult, TimeWindow } from '@copil/database';

@Injectable()
export class StatisticalAnalyzer {
  private readonly logger = new Logger(StatisticalAnalyzer.name);

  constructor(private readonly configService: ConfigService) {}

  filterOutliers(sources: PriceSource[]): PriceSource[] {
    if (sources.length < 3) return sources;

    const prices = sources.map((s) => s.price);
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const standardDeviation = Math.sqrt(
      prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length,
    );

    // Filter out prices more than 2 standard deviations from mean
    return sources.filter(
      (source) => Math.abs(source.price - mean) <= standardDeviation * 2,
    );
  }

  calculateVariance(prices: number[]): number {
    if (prices.length === 0) return 0;

    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    return (
      prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length
    );
  }

  calculateTWAP(historicalPrices: any[], window: TimeWindow): TWAPResult {
    if (historicalPrices.length === 0) {
      throw new Error('No historical prices available for TWAP calculation');
    }

    // Simple TWAP calculation
    const totalPrice = historicalPrices.reduce((sum, p) => sum + p.price, 0);
    const twap = totalPrice / historicalPrices.length;

    // Calculate standard deviation
    const variance = this.calculateVariance(
      historicalPrices.map((p) => p.price),
    );
    const standardDeviation = Math.sqrt(variance);

    // Calculate confidence based on data consistency
    const confidence = Math.max(0, 1 - standardDeviation / twap);

    return {
      tokenAddress: historicalPrices[0].tokenAddress,
      chain: historicalPrices[0].chain,
      twap,
      windowStart: new Date(Date.now() - window.duration * 1000),
      windowEnd: new Date(),
      dataPoints: historicalPrices.length,
      confidence,
      standardDeviation,
    };
  }
}
