import type { TransactionJobData, TransactionAction } from '@copil/database';

export type { TransactionJobData, TransactionAction };

// Define the strict TransactionRequest type here
export interface TransactionRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
}

export interface ExecutionResult {
  status: 'success' | 'failed' | 'skipped';
  description?: string;
  txHash?: string;
  transactionRequest?: TransactionRequest; // Use the strict type
  metadata?: Record<string, unknown>;
}