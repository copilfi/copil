/**
 * Enterprise Price Oracle Interface
 * Multi-source price validation with circuit breakers and anomaly detection
 */
import { TimeRange, TimeWindow } from '../types/common.types';

export interface IPriceOracleService {
  // === Core Price Operations ===
  getPrice(tokenAddress: string, chain: string): Promise<ValidatedPrice>;
  getBatchPrices(tokens: TokenPriceRequest[]): Promise<ValidatedPriceBatch>;
  getHistoricalPrice(tokenAddress: string, chain: string, timestamp: number): Promise<HistoricalPrice | null>;
  
  // === Oracle Health & Validation ===
  validateOracleHealth(): Promise<OracleHealthReport>;
  getSourceWeights(): Promise<OracleSourceWeights>;
  updateSourceWeights(weights: OracleSourceWeights): Promise<boolean>;
  
  // === Circuit Breaker Operations ===
  getCircuitBreakerStatus(): Promise<CircuitBreakerStatus>;
  manuallyTripCircuitBreaker(reason: string, duration: number): Promise<boolean>;
  resetCircuitBreaker(): Promise<boolean>;
  
  // === Anomaly Detection ===
  reportAnomaly(anomaly: PriceAnomaly): Promise<boolean>;
  getAnomalyHistory(timeRange: TimeRange): Promise<PriceAnomaly[]>;
  
  // === TWAP & Advanced Calculations ===
  calculateTWAP(tokenAddress: string, chain: string, window: TimeWindow): Promise<TWAPResult>;
  validatePriceDeviation(tokenAddress: string, chain: string, price: number): Promise<DeviationValidation>;
}

export interface ValidatedPrice {
  tokenAddress: string;
  chain: string;
  price: number;
  confidence: number; // 0-1, based on source agreement
  sources: PriceSource[];
  timestamp: Date;
  volume24h?: number;
  liquidityScore?: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  stale: boolean;
}

export interface PriceSource {
  name: string;
  price: number;
  confidence: number;
  timestamp: Date;
  latency: number; // ms
  error?: string;
}

export interface TokenPriceRequest {
  tokenAddress: string;
  chain: string;
  includeHistorical?: boolean;
  includeVolume?: boolean;
}

export interface ValidatedPriceBatch {
  prices: ValidatedPrice[];
  batchConfidence: number;
  processingTime: number;
  sourcesUsed: string[];
  warnings: string[];
}

export interface HistoricalPrice {
  tokenAddress: string;
  chain: string;
  price: number;
  timestamp: Date;
  confidence: number;
}

export interface OracleHealthReport {
  overall: 'healthy' | 'degraded' | 'failed';
  sources: SourceHealth[];
  lastUpdated: Date;
  activeSources: number;
  failedSources: number;
  warnings: string[];
}

export interface SourceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'failed';
  lastSuccessfulFetch: Date;
  averageLatency: number;
  errorRate: number;
  consecutiveFailures: number;
}

export interface OracleSourceWeights {
  weights: Record<string, number>; // source name -> weight (0-1)
  lastUpdated: Date;
  updatedBy: string;
}

export interface CircuitBreakerStatus {
  tripped: boolean;
  reason?: string;
  trippedAt?: Date;
  autoResetAt?: Date;
  manualOverride: boolean;
  failureCount: number;
  failureThreshold: number;
}

export interface PriceAnomaly {
  id: string;
  tokenAddress: string;
  chain: string;
  detectedAt: Date;
  anomalyType: 'price_spike' | 'liquidity_drop' | 'source_divergence' | 'volume_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedSources: string[];
  priceBefore?: number;
  priceAfter?: number;
  deviationPercent?: number;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface TWAPResult {
  tokenAddress: string;
  chain: string;
  twap: number;
  windowStart: Date;
  windowEnd: Date;
  dataPoints: number;
  confidence: number;
  standardDeviation: number;
}

export interface DeviationValidation {
  valid: boolean;
  deviationPercent: number;
  thresholdPercent: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendation: 'accept' | 'reject' | 'manual_review';
  explanation: string;
}

// === Oracle Source Configuration ===
export interface OracleSourceConfig {
  name: string;
  type: 'dex_aggregator' | 'cex' | 'chainlink' | 'custom';
  endpoint: string;
  apiKey?: string;
  rateLimit: number; // requests per minute
  timeout: number; // ms
  retryAttempts: number;
  weight: number; // 0-1
  enabled: boolean;
  supportedChains: string[];
  requiredFields: string[];
}

// === Price Validation Rules ===
export interface PriceValidationRule {
  name: string;
  type: 'max_deviation' | 'min_liquidity' | 'max_spread' | 'volume_check' | 'staleness';
  parameters: Record<string, any>;
  severity: 'warning' | 'error' | 'critical';
  action: 'log' | 'reject' | 'circuit_breaker';
}

export interface PriceValidationResult {
  passed: boolean;
  rules: RuleResult[];
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  recommendation: 'accept' | 'reject' | 'manual_review';
}

export interface RuleResult {
  ruleName: string;
  passed: boolean;
  message: string;
  severity: 'warning' | 'error' | 'critical';
}

// === Market Data Types ===
export interface MarketData {
  tokenAddress: string;
  chain: string;
  price: number;
  volume24h: number;
  liquidity: number;
  priceChange24h: number;
  marketCap?: number;
  circulatingSupply?: number;
  timestamp: Date;
  source: string;
}

export interface LiquidityData {
  tokenAddress: string;
  chain: string;
  poolAddress: string;
  liquidity: number;
  volume24h: number;
  apr?: number;
  feeTier?: number;
  timestamp: Date;
}

// === Configuration Types ===
export interface OracleConfig {
  sources: OracleSourceConfig[];
  validationRules: PriceValidationRule[];
  circuitBreaker: {
    failureThreshold: number;
    resetTimeout: number; // seconds
    halfOpenMaxCalls: number;
  };
  anomalyDetection: {
    enabled: boolean;
    sensitivity: number; // 0-1
    lookbackWindow: number; // seconds
  };
  caching: {
    enabled: boolean;
    ttl: number; // seconds
    maxSize: number;
  };
}
