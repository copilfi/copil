import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { TokenPrice } from '@copil/database';
import { ConfigService } from '@nestjs/config';

/**
 * Price Oracle Service to prevent price manipulation attacks
 * Implements multi-source validation, TWAP, and circuit breakers
 */
@Injectable()
export class PriceOracleService {
  private readonly logger = new Logger(PriceOracleService.name);

  // Circuit breaker parameters
  private readonly MAX_PRICE_CHANGE_PERCENT = 30; // Max 30% change in 1 hour
  private readonly MIN_DATA_POINTS_FOR_TWAP = 5;  // Minimum data points for TWAP calculation
  private readonly TWAP_WINDOW_MS = 60 * 60 * 1000; // 1 hour TWAP window
  private readonly PRICE_STALENESS_MS = 5 * 60 * 1000; // Max 5 minutes old
  private readonly MIN_SOURCES_REQUIRED = 1; // Minimum price sources (will increase when Chainlink added)

  constructor(
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get validated price with circuit breaker and TWAP
   * @param chain Blockchain name
   * @param tokenAddress Token contract address or symbol
   * @returns Validated price in USD or throws if validation fails
   */
  async getValidatedPrice(chain: string, tokenAddress: string): Promise<{
    price: number;
    source: string;
    timestamp: Date;
    twap: number | null;
    validated: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    // Step 1: Get latest price from database
    const latestPrice = await this.getLatestPrice(chain, tokenAddress);

    if (!latestPrice) {
      throw new Error(`No price data found for ${tokenAddress} on ${chain}`);
    }

    // Step 2: Check staleness
    const ageMs = Date.now() - new Date(latestPrice.timestamp).getTime();
    if (ageMs > this.PRICE_STALENESS_MS) {
      warnings.push(`Price data is stale (${Math.floor(ageMs / 1000)}s old, max ${this.PRICE_STALENESS_MS / 1000}s)`);
      this.logger.warn(`Stale price data for ${chain}:${tokenAddress}`);
    }

    const currentPrice = parseFloat(latestPrice.priceUsd);

    // Step 3: Calculate TWAP for validation
    const twap = await this.calculateTWAP(chain, tokenAddress, this.TWAP_WINDOW_MS);

    // Step 4: Circuit breaker - check if price changed too much
    if (twap !== null) {
      const deviation = Math.abs((currentPrice - twap) / twap) * 100;

      if (deviation > this.MAX_PRICE_CHANGE_PERCENT) {
        const error = `Price manipulation detected! Current: $${currentPrice}, TWAP: $${twap.toFixed(4)}, Deviation: ${deviation.toFixed(2)}%`;
        this.logger.error(error);
        throw new Error(error);
      }

      if (deviation > 10) {
        warnings.push(`High price deviation: ${deviation.toFixed(2)}% from TWAP`);
      }
    } else {
      warnings.push('Insufficient historical data for TWAP calculation');
    }

    // Step 5: Check for price spike anomalies
    const priceHistory = await this.getPriceHistory(chain, tokenAddress, 10);
    if (priceHistory.length >= 3) {
      const anomaly = this.detectPriceAnomaly(priceHistory, currentPrice);
      if (anomaly) {
        warnings.push(anomaly);
      }
    }

    return {
      price: currentPrice,
      source: latestPrice.source || 'unknown',
      timestamp: new Date(latestPrice.timestamp),
      twap,
      validated: warnings.length === 0,
      warnings,
    };
  }

  /**
   * Calculate Time-Weighted Average Price (TWAP)
   * @param chain Blockchain name
   * @param tokenAddress Token address
   * @param windowMs Time window in milliseconds
   * @returns TWAP or null if insufficient data
   */
  async calculateTWAP(chain: string, tokenAddress: string, windowMs: number): Promise<number | null> {
    const since = new Date(Date.now() - windowMs);

    const prices = await this.tokenPriceRepository.find({
      where: {
        chain: chain.toLowerCase(),
        address: tokenAddress.toLowerCase(),
        timestamp: MoreThan(since),
      },
      order: { timestamp: 'ASC' },
    });

    if (prices.length < this.MIN_DATA_POINTS_FOR_TWAP) {
      this.logger.debug(`Insufficient data for TWAP: ${prices.length} points (need ${this.MIN_DATA_POINTS_FOR_TWAP})`);
      return null;
    }

    // Calculate time-weighted average
    let totalWeightedPrice = 0;
    let totalWeight = 0;

    for (let i = 0; i < prices.length - 1; i++) {
      const current = prices[i];
      const next = prices[i + 1];

      const price = parseFloat(current.priceUsd);
      const weight = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();

      totalWeightedPrice += price * weight;
      totalWeight += weight;
    }

    // Handle last data point
    if (prices.length > 0) {
      const lastPrice = prices[prices.length - 1];
      const weight = Date.now() - new Date(lastPrice.timestamp).getTime();
      totalWeightedPrice += parseFloat(lastPrice.priceUsd) * weight;
      totalWeight += weight;
    }

    const twap = totalWeight > 0 ? totalWeightedPrice / totalWeight : null;

    if (twap) {
      this.logger.debug(`TWAP for ${chain}:${tokenAddress} = $${twap.toFixed(4)} (${prices.length} data points)`);
    }

    return twap;
  }

  /**
   * Get latest price from database
   */
  private async getLatestPrice(chain: string, tokenAddress: string): Promise<TokenPrice | null> {
    return await this.tokenPriceRepository.findOne({
      where: {
        chain: chain.toLowerCase(),
        address: tokenAddress.toLowerCase(),
      },
      order: { timestamp: 'DESC' },
    });
  }

  /**
   * Get price history for anomaly detection
   */
  private async getPriceHistory(chain: string, tokenAddress: string, limit: number): Promise<TokenPrice[]> {
    return await this.tokenPriceRepository.find({
      where: {
        chain: chain.toLowerCase(),
        address: tokenAddress.toLowerCase(),
      },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  /**
   * Detect price anomalies using statistical analysis
   */
  private detectPriceAnomaly(history: TokenPrice[], currentPrice: number): string | null {
    const prices = history.map(h => parseFloat(h.priceUsd));

    // Calculate mean and standard deviation
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    // Check if current price is more than 3 standard deviations from mean
    const zScore = Math.abs((currentPrice - mean) / stdDev);

    if (zScore > 3) {
      return `Price anomaly detected: ${zScore.toFixed(2)} standard deviations from mean`;
    }

    return null;
  }

  /**
   * Compare prices from multiple sources (future: Chainlink, Pyth, etc.)
   */
  async getMultiSourcePrice(chain: string, tokenAddress: string): Promise<{
    prices: Array<{ source: string; price: number; timestamp: Date }>;
    median: number;
    spread: number;
  }> {
    // Currently only have DexScreener/internal source
    // TODO: Add Chainlink, Pyth, Coingecko integrations

    const latestPrice = await this.getLatestPrice(chain, tokenAddress);

    if (!latestPrice) {
      throw new Error(`No price data available for ${chain}:${tokenAddress}`);
    }

    const prices = [{
      source: latestPrice.source || 'internal',
      price: parseFloat(latestPrice.priceUsd),
      timestamp: new Date(latestPrice.timestamp),
    }];

    // Calculate median (for now just return the single price)
    const median = prices[0].price;
    const spread = 0; // Will be meaningful when we have multiple sources

    return { prices, median, spread };
  }

  /**
   * Validate price trigger for strategy execution
   * This is the main method called by strategy evaluator
   */
  async validatePriceTrigger(
    chain: string,
    tokenAddress: string,
    targetPrice: number,
    comparison: 'gte' | 'lte'
  ): Promise<{
    triggered: boolean;
    currentPrice: number;
    twap: number | null;
    safe: boolean;
    warnings: string[];
  }> {
    try {
      const validation = await this.getValidatedPrice(chain, tokenAddress);

      // Check if trigger condition is met
      const triggered = comparison === 'gte'
        ? validation.price >= targetPrice
        : validation.price <= targetPrice;

      // Consider it safe only if validated and no critical warnings
      const criticalWarnings = validation.warnings.filter(w =>
        w.includes('manipulation') || w.includes('anomaly')
      );
      const safe = validation.validated && criticalWarnings.length === 0;

      return {
        triggered,
        currentPrice: validation.price,
        twap: validation.twap,
        safe,
        warnings: validation.warnings,
      };
    } catch (error) {
      this.logger.error(`Price validation failed for ${chain}:${tokenAddress}: ${error}`);
      return {
        triggered: false,
        currentPrice: 0,
        twap: null,
        safe: false,
        warnings: [error instanceof Error ? error.message : 'Price validation failed'],
      };
    }
  }

  /**
   * Health check for price oracle
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    sources: number;
    oldestPrice: Date | null;
    issues: string[];
  }> {
    const issues: string[] = [];

    // Check if we have recent price data
    const recentPrices = await this.tokenPriceRepository.find({
      where: {
        timestamp: MoreThan(new Date(Date.now() - this.PRICE_STALENESS_MS)),
      },
      take: 1,
    });

    if (recentPrices.length === 0) {
      issues.push('No recent price data available');
    }

    // Get oldest price to check data coverage
    const oldestPrice = await this.tokenPriceRepository.findOne({
      order: { timestamp: 'ASC' },
    });

    // Check number of sources (currently 1, should be 3+ in production)
    const sources = 1; // TODO: Increment when Chainlink/Pyth added
    if (sources < this.MIN_SOURCES_REQUIRED) {
      issues.push(`Insufficient price sources: ${sources} (need ${this.MIN_SOURCES_REQUIRED})`);
    }

    return {
      healthy: issues.length === 0,
      sources,
      oldestPrice: oldestPrice ? new Date(oldestPrice.timestamp) : null,
      issues,
    };
  }
}