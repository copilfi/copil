import type { TransactionIntent } from '@copil/database';

export interface GetAggregatedBalanceRequest {
  userAddresses: string[];
}

export interface AssetBalance {
  assetId: string; // e.g., 'ob:eth', 'ob:usdc', 'eip155:1/erc20:0x...' 
  symbol: string;
  name: string;
  amount: string; // In smallest unit
  amountUsd: string;
}

export interface GetAggregatedBalanceResponse {
  balances: AssetBalance[];
}

export interface GetQuoteRequest {
  intent: TransactionIntent;
}

export interface Quote {
  // This will be defined by the OneBalance API response structure
  // For now, it's a placeholder
  id: string;
  fromAmount: string;
  toAmount: string;
  gasCostUsd?: string; // Made optional
  transactionRequest: any; // The raw request for signing
  approvalTransactionRequest?: any; // Optional approval tx before main tx
}

export interface GetQuoteResponse {
  quote: Quote;
}


// Re-export the canonical type
export type { TransactionIntent };
