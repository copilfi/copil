export type SessionActionType = 'swap' | 'bridge' | 'custom';

export interface SessionSpendLimit {
  token: string; // ERC-20 address or special 'native'
  maxAmount: string; // per-transaction cap in smallest unit
  windowSec?: number; // optional time window for future aggregate checks
}

export interface SessionKeyPermissions {
  actions?: SessionActionType[];
  chains?: string[];
  allowedContracts?: string[]; // whitelist of destination contracts (tx.to)
  spendLimits?: SessionSpendLimit[]; // simple per-tx caps; aggregate window optional
  notes?: string;
}
