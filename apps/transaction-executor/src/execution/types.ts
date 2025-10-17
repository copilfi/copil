import type { TransactionJobData, TransactionIntent } from '@copil/database';

export type { TransactionJobData, TransactionIntent };

// Define the strict TransactionRequest type here
export interface TransactionRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
}

export interface ExecutionResult {
  status: 'success' | 'failed' | 'skipped' | 'pending';
  description?: string;
  txHash?: string;
  transactionRequest?: any; // Loosening this type to accommodate OneBalance's structure for now
  metadata?: Record<string, unknown>;
}