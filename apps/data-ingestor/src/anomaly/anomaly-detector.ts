import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceAnomaly } from '@copil/database';

@Injectable()
export class AnomalyDetector {
  private readonly logger = new Logger(AnomalyDetector.name);

  constructor(private readonly configService: ConfigService) {}

  async detectAnomalies(
    tokenAddress: string,
    chain: string,
    price: number,
    sources: any[],
  ): Promise<PriceAnomaly[]> {
    const anomalies: PriceAnomaly[] = [];

    try {
      // Simple anomaly detection logic
      const prices = sources.map((s) => s.price).filter((p) => p > 0);
      if (prices.length < 2) return anomalies;

      const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const standardDeviation = Math.sqrt(
        prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) /
          prices.length,
      );

      // Check for outliers (2 standard deviations)
      for (const source of sources) {
        const deviation = Math.abs(source.price - mean);
        if (deviation > standardDeviation * 2) {
          anomalies.push({
            id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            tokenAddress,
            chain,
            anomalyType: 'source_divergence' as const,
            detectedAt: new Date(),
            severity: deviation > standardDeviation * 3 ? 'high' : 'medium',
            description: `Price deviation of ${((deviation / mean) * 100).toFixed(2)}% from mean`,
            affectedSources: [source.name],
            priceBefore: mean,
            priceAfter: source.price,
            deviationPercent: (deviation / mean) * 100,
            resolved: false,
          });
        }
      }

      return anomalies;
    } catch (error) {
      this.logger.error(
        `Anomaly detection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return anomalies;
    }
  }

  async report(anomaly: PriceAnomaly): Promise<boolean> {
    try {
      this.logger.warn(`Anomaly reported: ${anomaly.description}`);
      // Store anomaly in database or send to monitoring system
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to report anomaly: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async getHistory(timeRange: any): Promise<PriceAnomaly[]> {
    // Placeholder implementation
    return [];
  }
}
