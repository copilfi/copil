export type TransactionAction =
  | {
      type: 'swap';
      chainId: string;
      assetIn: string;
      assetOut: string;
      amountIn: string; // e.g., "0.1" for absolute, or "20" for percentage
      amountInIsPercentage?: boolean; // If true, amountIn is a percentage
      slippageBps?: number;
    }
  | {
      type: 'bridge';
      fromChainId: string;
      toChainId: string;
      assetIn: string;
      assetOut: string;
      amountIn: string; // e.g., "0.1" for absolute, or "20" for percentage
      amountInIsPercentage?: boolean; // If true, amountIn is a percentage
      slippageBps?: number;
    }
  | {
      type: 'custom';
      name: string;
      parameters: Record<string, unknown>;
    };

export interface TransactionJobData {
  strategyId: number | null; // Can be null for ad-hoc jobs
  userId: number;
  sessionKeyId?: number;
  action: TransactionAction;
  metadata?: Record<string, unknown>;
}