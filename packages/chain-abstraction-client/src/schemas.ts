import { z } from 'zod';

// Schema for a single asset balance
export const AssetBalanceSchema = z.object({
  assetId: z.string(),
  symbol: z.string(),
  name: z.string(),
  amount: z.string(),
  amountUsd: z.string(),
});

// Schema for the aggregated balance API response
export const GetAggregatedBalanceResponseSchema = z.object({
  balances: z.array(AssetBalanceSchema),
});

// Schema for the quote API response
export const QuoteSchema = z.object({
  id: z.string(),
  fromAmount: z.string(),
  toAmount: z.string(),
  gasCostUsd: z.string().optional(),
  transactionRequest: z.object({
    to: z.string(),
    data: z.string(),
    value: z.string().optional(),
  }),
  // Add other fields from OneBalance quote response as needed
});

export const GetQuoteResponseSchema = z.object({
  quote: QuoteSchema,
});
