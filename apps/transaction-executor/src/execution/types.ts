import type { TransactionJobData, TransactionAction } from '@copil/database';

export type { TransactionJobData, TransactionAction };

export interface ExecutionResult {
  status: 'success' | 'failed' | 'skipped';
  description?: string;
  txHash?: string;
  transactionRequest?: {
    to: string;
    data: string;
    value?: string;
  };
  metadata?: Record<string, unknown>;
}
