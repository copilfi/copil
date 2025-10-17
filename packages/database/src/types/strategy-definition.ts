import { TransactionIntent } from './transaction-job';

export type PriceComparator = 'gte' | 'lte';

export interface PriceTriggerDefinition {
  type: 'price';
  chain: string;
  tokenAddress: string;
  priceTarget: number;
  comparator?: PriceComparator;
}

export type StrategyTriggerDefinition = PriceTriggerDefinition;

export interface StrategyDefinition {
  trigger: StrategyTriggerDefinition;
  intent: TransactionIntent;
  repeat?: boolean;
  sessionKeyId?: number;
}
