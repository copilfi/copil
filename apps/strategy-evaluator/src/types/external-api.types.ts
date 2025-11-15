/**
 * External API Type Definitions - Clean Code: Type Safety
 * Defines interfaces for external API responses to eliminate unsafe types
 */

// Dexscreener API Response Types
export interface DexscreenerToken {
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  priceNative: string;
}

export interface DexscreenerResponse {
  pairs: DexscreenerToken[];
}

// CoinGecko API Response Types
export interface CoinGeckoPriceData {
  usd: number;
}

export interface CoinGeckoResponse {
  [tokenAddress: string]: CoinGeckoPriceData;
}

// Bull Queue Job Types
export interface StrategyJobData {
  strategyId: number;
  userId: number;
  definition: any;
}

export interface BullJob {
  id: string;
  data: StrategyJobData;
  opts?: {
    delay?: number;
    attempts?: number;
    backoff?: string;
  };
}

export interface BullQueue {
  getJobs(types: string[], start?: number, end?: number): Promise<BullJob[]>;
  add(
    name: string,
    data: StrategyJobData,
    opts?: BullJob['opts'],
  ): Promise<BullJob>;
}

// Strategy Definition Types
export interface StrategyDefinition {
  name: string;
  description?: string;
  conditions: any[];
  actions: any[];
}

// External API Token Info
export interface TokenInfo {
  name: string;
  price: number;
}
