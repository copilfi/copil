import type { TransactionJobData, TransactionIntent } from '@copil/database';

export type { TransactionJobData, TransactionIntent };

// Define the strict TransactionRequest type here
export interface TransactionRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
  // Security fields for transaction validation
  maxSlippagePercent?: number; // Max acceptable slippage (e.g., 2.5 for 2.5%)
  deadline?: number; // Unix timestamp for transaction deadline
  nonce?: number; // Transaction nonce for replay protection
  maxAmount?: string; // Maximum amount allowed for this transaction
  minAmountOut?: string; // Minimum amount expected from swap (for DEX transactions)
  gasLimit?: string; // Gas limit to prevent gas manipulation
  priorityFee?: string; // Maximum priority fee to prevent MEV
}

export interface ExecutionResult {
  status: 'success' | 'failed' | 'skipped' | 'pending';
  description?: string;
  txHash?: string;
  transactionRequest?: any; // Loosening this type to accommodate OneBalance's structure for now
  metadata?: Record<string, unknown>;
}
