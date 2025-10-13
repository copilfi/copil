export type TransactionAction =
  | {
      type: 'swap';
      chainId: string;
      assetIn: string;
      assetOut: string;
      amountIn: string;
      slippageBps?: number;
    }
  | {
      type: 'bridge';
      fromChainId: string;
      toChainId: string;
      assetIn: string;
      assetOut: string;
      amountIn: string;
      slippageBps?: number;
    }
  | {
      type: 'custom';
      name: string;
      parameters: Record<string, unknown>;
    };

export interface TransactionJobData {
  strategyId: number;
  userId: number;
  sessionKeyId?: number;
  action: TransactionAction;
  metadata?: Record<string, unknown>;
}
