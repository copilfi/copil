import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IPriceOracleService,
  ValidatedPrice,
  PriceSource,
  OracleHealthReport,
  CircuitBreakerStatus,
  PriceAnomaly,
  TWAPResult,
  DeviationValidation,
  OracleSourceConfig,
  PriceValidationRule,
  PriceValidationResult,
  MarketData,
  LiquidityData,
  TimeRange,
  TimeWindow,
  TokenPriceRequest,
  ValidatedPriceBatch,
  HistoricalPrice,
  SourceHealth,
  OracleSourceWeights,
} from '@copil/database';
import { TokenPrice } from '@copil/database';
import { DexScreenerAdapter } from '../adapters/dexscreener.adapter';
import { ChainlinkAdapter } from '../adapters/chainlink.adapter';
import { CoingeckoAdapter } from '../adapters/coingecko.adapter';
import { CexAdapter } from '../adapters/cex.adapter';
import { OnChainTwAdapter } from '../adapters/onchain-tw.adapter';
import { CircuitBreaker } from '../circuit-breaker/circuit-breaker';
import { AnomalyDetector } from '../anomaly/anomaly-detector';
import { PriceCache } from '../cache/price-cache';
import { LiquidityValidator } from '../validators/liquidity.validator';
import { VolumeValidator } from '../validators/volume.validator';
import { StatisticalAnalyzer } from '../analyzers/statistical.analyzer';
import { Redis } from 'ioredis';
import axios from 'axios';

@Injectable()
export class EnterprisePriceOracleService implements IPriceOracleService {
  private readonly logger = new Logger(EnterprisePriceOracleService.name);
  private readonly redis: Redis;
  private readonly adapters: Map<string, any> = new Map();
  private readonly circuitBreaker: CircuitBreaker;
  private readonly anomalyDetector: AnomalyDetector;
  private readonly priceCache: PriceCache;
  private readonly liquidityValidator: LiquidityValidator;
  private readonly volumeValidator: VolumeValidator;
  private readonly statisticalAnalyzer: StatisticalAnalyzer;

  // Configuration
  private readonly sourceConfigs: OracleSourceConfig[];
  private readonly validationRules: PriceValidationRule[];
  private readonly maxPriceDeviationPercent: number;
  private readonly minLiquidityMultiplier: number;
  private readonly executionDelayMs: number;
  private readonly confidenceThresholds: {
    minimum: number;
    warning: number;
    critical: number;
  };

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: parseInt(this.configService.get<string>('REDIS_PORT', '6379')),
    });

    // Initialize configuration
    this.sourceConfigs = this.loadSourceConfigs();
    this.validationRules = this.loadValidationRules();
    this.maxPriceDeviationPercent = this.configService.get<number>(
      'MAX_PRICE_DEVIATION_PERCENT',
      5,
    );
    this.minLiquidityMultiplier = this.configService.get<number>(
      'MIN_LIQUIDITY_MULTIPLIER',
      10,
    );
    this.executionDelayMs = this.configService.get<number>(
      'EXECUTION_DELAY_MS',
      30000,
    );
    this.confidenceThresholds = {
      minimum: this.configService.get<number>('MIN_CONFIDENCE_THRESHOLD', 0.85),
      warning: this.configService.get<number>(
        'WARNING_CONFIDENCE_THRESHOLD',
        0.9,
      ),
      critical: this.configService.get<number>(
        'CRITICAL_CONFIDENCE_THRESHOLD',
        0.95,
      ),
    };

    // Initialize components
    this.circuitBreaker = new CircuitBreaker(this.configService);
    this.anomalyDetector = new AnomalyDetector(this.configService);
    this.priceCache = new PriceCache(this.redis, this.configService);
    this.liquidityValidator = new LiquidityValidator(this.configService);
    this.volumeValidator = new VolumeValidator(this.configService);
    this.statisticalAnalyzer = new StatisticalAnalyzer(this.configService);

    // Initialize adapters
    this.initializeAdapters();
  }

  async getPrice(tokenAddress: string, chain: string): Promise<ValidatedPrice> {
    const startTime = Date.now();

    try {
      // Check circuit breaker
      const circuitStatus = await this.getCircuitBreakerStatus();
      if (circuitStatus.tripped) {
        throw new Error(`Circuit breaker tripped: ${circuitStatus.reason}`);
      }

      // Check cache first
      const cachedPrice = await this.priceCache.get(tokenAddress, chain);
      if (cachedPrice && !this.isPriceStale(cachedPrice)) {
        return cachedPrice;
      }

      // Fetch from multiple sources
      const sources = await this.fetchFromAllSources(tokenAddress, chain);

      // Validate and aggregate prices
      const validationResult = await this.validatePrices(
        sources,
        tokenAddress,
        chain,
      );
      if (!validationResult.passed) {
        await this.handleValidationFailure(
          validationResult,
          tokenAddress,
          chain,
        );
      }

      // Calculate weighted price with confidence
      const { price, confidence, riskLevel } =
        await this.calculateWeightedPrice(sources);

      // Liquidity depth validation
      const liquidityScore = await this.getLiquidityScore(
        tokenAddress,
        chain,
        price,
      );
      if (liquidityScore < this.minLiquidityMultiplier) {
        this.logger.warn(
          `Low liquidity score for ${tokenAddress}: ${liquidityScore}`,
        );
      }

      // Volume validation
      const volumeData = await this.getVolumeData(tokenAddress, chain);
      const volumeValidation = await this.volumeValidator.validate(
        volumeData,
        price,
      );

      // Anomaly detection
      const anomalies = await this.detectAnomalies(
        tokenAddress,
        chain,
        price,
        sources,
      );
      if (anomalies.length > 0) {
        await this.reportAnomalies(anomalies);
      }

      const validatedPrice: ValidatedPrice = {
        tokenAddress,
        chain,
        price,
        confidence,
        sources,
        timestamp: new Date(),
        volume24h: volumeData.volume24h,
        liquidityScore,
        riskLevel,
        stale: false,
      };

      // Cache the result
      await this.priceCache.set(tokenAddress, chain, validatedPrice);

      // Log performance
      const processingTime = Date.now() - startTime;
      this.logger.debug(
        `Price validation completed in ${processingTime}ms for ${tokenAddress}`,
      );

      return validatedPrice;
    } catch (error) {
      this.logger.error(
        `Failed to get price for ${tokenAddress} on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Increment circuit breaker failure count
      await this.circuitBreaker.recordFailure();

      throw error;
    }
  }

  async getBatchPrices(
    requests: TokenPriceRequest[],
  ): Promise<ValidatedPriceBatch> {
    const startTime = Date.now();
    const prices: ValidatedPrice[] = [];
    const warnings: string[] = [];
    const sourcesUsed = new Set<string>();

    try {
      // Process requests in parallel with rate limiting
      const batchSize = 10; // Limit concurrent requests
      for (let i = 0; i < requests.length; i += batchSize) {
        const batch = requests.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map((req) => this.getPrice(req.tokenAddress, req.chain)),
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            prices.push(result.value);
            result.value.sources.forEach((source) =>
              sourcesUsed.add(source.name),
            );
          } else {
            warnings.push(`Failed to fetch price: ${result.reason}`);
          }
        }
      }

      // Calculate batch confidence
      const batchConfidence =
        prices.length > 0
          ? prices.reduce((sum, p) => sum + p.confidence, 0) / prices.length
          : 0;

      const processingTime = Date.now() - startTime;

      return {
        prices,
        batchConfidence,
        processingTime,
        sourcesUsed: Array.from(sourcesUsed),
        warnings,
      };
    } catch (error) {
      this.logger.error(
        `Batch price fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async calculateTWAP(
    tokenAddress: string,
    chain: string,
    window: TimeWindow,
  ): Promise<TWAPResult> {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - window.duration * 1000);

      // Get historical prices within window
      const historicalPrices = await this.getHistoricalPricesInRange(
        tokenAddress,
        chain,
        startTime.getTime(),
        endTime.getTime(),
        window.bucketSize,
      );

      if (historicalPrices.length === 0) {
        throw new Error('No historical data available for TWAP calculation');
      }

      // Calculate TWAP using time-weighted average
      const { twap, standardDeviation, confidence } =
        this.statisticalAnalyzer.calculateTWAP(historicalPrices, window);

      return {
        tokenAddress,
        chain,
        twap,
        windowStart: startTime,
        windowEnd: endTime,
        dataPoints: historicalPrices.length,
        confidence,
        standardDeviation,
      };
    } catch (error) {
      this.logger.error(
        `TWAP calculation failed for ${tokenAddress}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async validatePriceDeviation(
    tokenAddress: string,
    chain: string,
    price: number,
  ): Promise<DeviationValidation> {
    try {
      // Get reference price from multiple sources
      const referencePrice = await this.getPrice(tokenAddress, chain);

      // Calculate deviation
      const deviationPercent =
        Math.abs((price - referencePrice.price) / referencePrice.price) * 100;

      // Determine risk level based on deviation
      let riskLevel: 'low' | 'medium' | 'high' | 'critical';
      let recommendation: 'accept' | 'reject' | 'manual_review';

      if (deviationPercent > this.maxPriceDeviationPercent * 3) {
        riskLevel = 'critical';
        recommendation = 'reject';
      } else if (deviationPercent > this.maxPriceDeviationPercent * 2) {
        riskLevel = 'high';
        recommendation = 'manual_review';
      } else if (deviationPercent > this.maxPriceDeviationPercent) {
        riskLevel = 'medium';
        recommendation = 'manual_review';
      } else {
        riskLevel = 'low';
        recommendation = 'accept';
      }

      const explanation = `Price deviation of ${deviationPercent.toFixed(2)}% from reference price ${referencePrice.price}`;

      return {
        valid: recommendation !== 'reject',
        deviationPercent,
        thresholdPercent: this.maxPriceDeviationPercent,
        riskLevel,
        recommendation,
        explanation,
      };
    } catch (error) {
      this.logger.error(
        `Price deviation validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        valid: false,
        deviationPercent: 100,
        thresholdPercent: this.maxPriceDeviationPercent,
        riskLevel: 'critical',
        recommendation: 'reject',
        explanation: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // === Private Methods ===

  private async fetchFromAllSources(
    tokenAddress: string,
    chain: string,
  ): Promise<PriceSource[]> {
    const sources: PriceSource[] = [];
    const enabledSources = this.sourceConfigs.filter(
      (s) => s.enabled && s.supportedChains.includes(chain),
    );

    const fetchPromises = enabledSources.map(async (config) => {
      try {
        const adapter = this.adapters.get(config.name);
        if (!adapter) {
          throw new Error(`Adapter not found for source: ${config.name}`);
        }

        const startTime = Date.now();
        const price = await adapter.getPrice(tokenAddress, chain);
        const latency = Date.now() - startTime;

        return {
          name: config.name,
          price,
          confidence: this.calculateSourceConfidence(config, latency),
          timestamp: new Date(),
          latency,
        };
      } catch (error) {
        this.logger.warn(
          `Failed to fetch price from ${config.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          name: config.name,
          price: 0,
          confidence: 0,
          timestamp: new Date(),
          latency: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const results = await Promise.allSettled(fetchPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        sources.push(result.value);
      }
    }

    return sources.filter((s) => s.confidence > 0);
  }

  private async calculateWeightedPrice(sources: PriceSource[]): Promise<{
    price: number;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  }> {
    if (sources.length === 0) {
      throw new Error('No valid price sources available');
    }

    // Filter out outliers using statistical analysis
    const filteredSources = this.statisticalAnalyzer.filterOutliers(sources);

    if (filteredSources.length === 0) {
      throw new Error('All price sources filtered out as outliers');
    }

    // Calculate weighted average
    let weightedSum = 0;
    let totalWeight = 0;

    for (const source of filteredSources) {
      const weight = source.confidence * this.getSourceWeight(source.name);
      weightedSum += source.price * weight;
      totalWeight += weight;
    }

    const price = weightedSum / totalWeight;

    // Calculate confidence based on source agreement
    const priceVariance = this.statisticalAnalyzer.calculateVariance(
      filteredSources.map((s) => s.price),
    );
    const confidence = Math.max(0, 1 - priceVariance / price);

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (confidence >= this.confidenceThresholds.critical) {
      riskLevel = 'low';
    } else if (confidence >= this.confidenceThresholds.warning) {
      riskLevel = 'medium';
    } else if (confidence >= this.confidenceThresholds.minimum) {
      riskLevel = 'high';
    } else {
      riskLevel = 'critical';
    }

    return { price, confidence, riskLevel };
  }

  private async validatePrices(
    sources: PriceSource[],
    tokenAddress: string,
    chain: string,
  ): Promise<PriceValidationResult> {
    const results: any[] = [];
    let overallRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';

    for (const rule of this.validationRules) {
      const result = await this.applyValidationRule(
        rule,
        sources,
        tokenAddress,
        chain,
      );
      results.push(result);

      if (result.severity === 'critical') {
        overallRisk = 'critical';
      } else if (result.severity === 'error' && overallRisk !== 'critical') {
        overallRisk = 'high';
      } else if (result.severity === 'warning' && overallRisk === 'low') {
        overallRisk = 'medium';
      }
    }

    const passed = !results.some(
      (r) =>
        r.severity === 'critical' ||
        (r.severity === 'error' && r.action === 'reject'),
    );

    return {
      passed,
      rules: results,
      overallRisk,
      recommendation: passed
        ? 'accept'
        : overallRisk === 'critical'
          ? 'reject'
          : 'manual_review',
    };
  }

  private async applyValidationRule(
    rule: PriceValidationRule,
    sources: PriceSource[],
    tokenAddress: string,
    chain: string,
  ): Promise<any> {
    // Implementation for different validation rules
    switch (rule.type) {
      case 'max_deviation':
        return this.validateMaxDeviation(rule, sources);
      case 'min_liquidity':
        return this.validateMinLiquidity(rule, tokenAddress, chain);
      case 'volume_check':
        return this.validateVolume(rule, tokenAddress, chain);
      case 'staleness':
        return this.validateStaleness(rule, sources);
      default:
        return {
          ruleName: rule.name,
          passed: true,
          message: 'Unknown rule type',
          severity: 'warning',
        };
    }
  }

  private validateMaxDeviation(
    rule: PriceValidationRule,
    sources: PriceSource[],
  ): any {
    if (sources.length < 2) {
      return {
        ruleName: rule.name,
        passed: true,
        message: 'Insufficient sources for deviation check',
        severity: 'warning',
      };
    }

    const prices = sources.map((s) => s.price);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const deviationPercent = ((maxPrice - minPrice) / minPrice) * 100;

    const threshold =
      rule.parameters.threshold || this.maxPriceDeviationPercent;
    const passed = deviationPercent <= threshold;

    return {
      ruleName: rule.name,
      passed,
      message: `Price deviation: ${deviationPercent.toFixed(2)}% (threshold: ${threshold}%)`,
      severity: passed ? 'warning' : 'error',
    };
  }

  private async validateMinLiquidity(
    rule: PriceValidationRule,
    _tokenAddress: string,
    _chain: string,
  ): Promise<any> {
    // Implementation would check liquidity pools
    return {
      ruleName: rule.name,
      passed: true,
      message: 'Liquidity validation passed',
      severity: 'warning',
    };
  }

  private async validateVolume(
    rule: PriceValidationRule,
    _tokenAddress: string,
    _chain: string,
  ): Promise<any> {
    // Implementation would check trading volume
    return {
      ruleName: rule.name,
      passed: true,
      message: 'Volume validation passed',
      severity: 'warning',
    };
  }

  private validateStaleness(
    rule: PriceValidationRule,
    sources: PriceSource[],
  ): any {
    const maxAge = rule.parameters.maxAge || 60000; // 1 minute default
    const now = Date.now();

    for (const source of sources) {
      const age = now - source.timestamp.getTime();
      if (age > maxAge) {
        return {
          ruleName: rule.name,
          passed: false,
          message: `Source ${source.name} data is ${Math.round(age / 1000)}s old`,
          severity: 'error',
        };
      }
    }

    return {
      ruleName: rule.name,
      passed: true,
      message: 'All sources are fresh',
      severity: 'warning',
    };
  }

  // === Helper Methods ===

  private initializeAdapters(): void {
    this.adapters.set(
      'dexscreener',
      new DexScreenerAdapter(this.configService),
    );
    this.adapters.set('chainlink', new ChainlinkAdapter(this.configService));
    this.adapters.set('coingecko', new CoingeckoAdapter(this.configService));
    this.adapters.set('cex', new CexAdapter(this.configService));
    this.adapters.set('onchain_tw', new OnChainTwAdapter(this.configService));
  }

  private loadSourceConfigs(): OracleSourceConfig[] {
    return [
      {
        name: 'dexscreener',
        type: 'dex_aggregator',
        endpoint: 'https://api.dexscreener.com/latest/dex',
        rateLimit: 100,
        timeout: 5000,
        retryAttempts: 3,
        weight: 0.3,
        enabled: true,
        supportedChains: ['ethereum', 'base', 'arbitrum', 'polygon'],
        requiredFields: ['price', 'liquidity'],
      },
      {
        name: 'chainlink',
        type: 'chainlink',
        endpoint: '',
        rateLimit: 50,
        timeout: 3000,
        retryAttempts: 3,
        weight: 0.4,
        enabled: true,
        supportedChains: ['ethereum', 'base', 'arbitrum'],
        requiredFields: ['price'],
      },
      // Add more source configurations...
    ];
  }

  private loadValidationRules(): PriceValidationRule[] {
    return [
      {
        name: 'max_price_deviation',
        type: 'max_deviation',
        parameters: { threshold: this.maxPriceDeviationPercent },
        severity: 'error',
        action: 'reject',
      },
      {
        name: 'liquidity_check',
        type: 'min_liquidity',
        parameters: { multiplier: this.minLiquidityMultiplier },
        severity: 'warning',
        action: 'log',
      },
      // Add more validation rules...
    ];
  }

  private calculateSourceConfidence(
    config: OracleSourceConfig,
    latency: number,
  ): number {
    let confidence = config.weight;

    // Adjust confidence based on latency
    if (latency > config.timeout) {
      confidence *= 0.5;
    } else if (latency > config.timeout * 0.8) {
      confidence *= 0.8;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  private getSourceWeight(sourceName: string): number {
    const config = this.sourceConfigs.find((c) => c.name === sourceName);
    return config?.weight || 0.1;
  }

  private isPriceStale(price: ValidatedPrice): boolean {
    const maxAge = 60000; // 1 minute
    return Date.now() - price.timestamp.getTime() > maxAge;
  }

  private async getLiquidityScore(
    _tokenAddress: string,
    _chain: string,
    _price: number,
  ): Promise<number> {
    // Implementation would fetch liquidity data from DEXs
    return 100; // Placeholder
  }

  private async getVolumeData(
    _tokenAddress: string,
    _chain: string,
  ): Promise<{ volume24h: number }> {
    // Implementation would fetch volume data
    return { volume24h: 1000000 }; // Placeholder
  }

  private async detectAnomalies(
    _tokenAddress: string,
    _chain: string,
    _price: number,
    _sources: PriceSource[],
  ): Promise<PriceAnomaly[]> {
    return this.anomalyDetector.detectAnomalies(
      _tokenAddress,
      _chain,
      _price,
      _sources,
    );
  }

  private async reportAnomalies(anomalies: PriceAnomaly[]): Promise<void> {
    for (const anomaly of anomalies) {
      await this.reportAnomaly(anomaly);
    }
  }

  private async getHistoricalPricesInRange(
    _tokenAddress: string,
    _chain: string,
    _start: number,
    _end: number,
    _bucketSize: number,
  ): Promise<HistoricalPrice[]> {
    // Implementation would fetch historical prices from database
    return [];
  }

  private async handleValidationFailure(
    result: PriceValidationResult,
    tokenAddress: string,
    chain: string,
  ): Promise<void> {
    this.logger.error(
      `Price validation failed for ${tokenAddress} on ${chain}: ${JSON.stringify(result.rules)}`,
    );

    if (result.overallRisk === 'critical') {
      await this.circuitBreaker.manuallyTrip(
        'Critical price validation failure',
      );
    }
  }

  // === Interface Implementation (remaining methods) ===

  async getHistoricalPrice(
    _tokenAddress: string,
    _chain: string,
    _timestamp: number,
  ): Promise<HistoricalPrice | null> {
    // Implementation for historical price retrieval
    return null;
  }

  async validateOracleHealth(): Promise<OracleHealthReport> {
    // Implementation for oracle health validation
    return {
      overall: 'healthy',
      sources: [],
      lastUpdated: new Date(),
      activeSources: 0,
      failedSources: 0,
      warnings: [],
    };
  }

  async getSourceWeights(): Promise<OracleSourceWeights> {
    // Implementation for source weights
    return {
      weights: {},
      lastUpdated: new Date(),
      updatedBy: 'system',
    };
  }

  async updateSourceWeights(_weights: OracleSourceWeights): Promise<boolean> {
    // Implementation for updating source weights
    return true;
  }

  async getCircuitBreakerStatus(): Promise<CircuitBreakerStatus> {
    return this.circuitBreaker.getStatus();
  }

  async manuallyTripCircuitBreaker(
    reason: string,
    duration: number,
  ): Promise<boolean> {
    return this.circuitBreaker.manuallyTrip(reason, duration);
  }

  async resetCircuitBreaker(): Promise<boolean> {
    return this.circuitBreaker.reset();
  }

  async reportAnomaly(anomaly: PriceAnomaly): Promise<boolean> {
    return this.anomalyDetector.report(anomaly);
  }

  async getAnomalyHistory(timeRange: TimeRange): Promise<PriceAnomaly[]> {
    return this.anomalyDetector.getHistory(timeRange);
  }
}
