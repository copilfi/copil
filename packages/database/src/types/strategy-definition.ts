import { TransactionIntent } from './transaction-job';

export type PriceComparator = 'gte' | 'lte';

export interface PriceTriggerDefinition {
  type: 'price';
  chain: string;
  tokenAddress: string;
  priceTarget: number;
  comparator?: PriceComparator;
}

export interface TrendTriggerDefinition {
  type: 'trend';
  chain: string;
  tokenAddress: string;
  top?: number; // consider as trending if within top N (default 10)
}

export type StrategyTriggerDefinition = PriceTriggerDefinition | TrendTriggerDefinition;

export interface StrategyDefinition {
  trigger: StrategyTriggerDefinition;
  intent: TransactionIntent;
  repeat?: boolean;
  sessionKeyId?: number;
}
