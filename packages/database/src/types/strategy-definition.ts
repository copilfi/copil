import { TransactionAction } from './transaction-job';

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
  action: TransactionAction;
  repeat?: boolean;
  sessionKeyId?: number;
}
