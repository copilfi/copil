export type TransactionIntent =
  | {
      type: 'swap' | 'bridge';
      fromChain: string;
      toChain: string;
      fromToken: string;
      toToken: string;
      fromAmount: string;
      userAddress: string;
      slippageBps?: number;
    }
  | {
      type: 'custom';
      name: string;
      parameters: Record<string, unknown>;
    };

// This is the data that will be passed to the transaction queue
export interface TransactionJobData {
  strategyId: number | null; // Can be null for ad-hoc jobs
  userId: number;
  sessionKeyId: number;
  intent: TransactionIntent;
  quote: any; // The quote object received from the chain abstraction layer (e.g., OneBalance)
  metadata?: Record<string, unknown>;
}
