export type SessionActionType = 'swap' | 'bridge' | 'custom' | 'transfer' | 'open_position' | 'close_position';

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
  timeWindow?: {
    start: string; // HH:mm
    end: string;   // HH:mm
    timezone: string;
  };
  cooldownPeriod?: number; // seconds
  // Optional Hyperliquid-specific policy extensions
  hlAllowedMarkets?: string[];
  hlMaxUsdPerTrade?: number;
}
