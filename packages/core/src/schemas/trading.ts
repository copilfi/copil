import { z } from 'zod';

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const TokenSchema = z.object({
  address: AddressSchema,
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  decimals: z.number().int().min(0).max(18),
  logoURI: z.string().url().optional(),
  coingeckoId: z.string().optional(),
});

export const TokenAmountSchema = z.object({
  token: TokenSchema,
  amount: z.string(), // Decimal as string
  amountRaw: z.string(), // bigint as string
});

export const TradingConditionSchema = z.object({
  type: z.enum(['price', 'time', 'volume', 'custom']),
  operator: z.enum(['>', '<', '==', '>=', '<=']),
  value: z.union([z.number(), z.string()]),
  chainlinkOracle: AddressSchema.optional(),
  pythPriceId: z.string().optional(),
});

export const DCAParametersSchema = z.object({
  frequency: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
  amount: z.string(), // Decimal as string
  totalOrders: z.number().int().positive(),
  currentOrder: z.number().int().min(0),
});

export const StrategyParametersSchema = z.object({
  stopLoss: z.number().min(0).max(100).optional(),
  takeProfit: z.number().positive().optional(),
  slippage: z.number().min(0.01).max(30),
  dca: DCAParametersSchema.optional(),
  maxGasPrice: z.string().optional(), // Decimal as string
});

export const TradingIntentSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['swap', 'limit_order', 'yield_farm', 'provide_liquidity']),
  tokens: z.object({
    from: TokenSchema,
    to: TokenSchema,
  }),
  amount: TokenAmountSchema,
  conditions: z.array(TradingConditionSchema).optional(),
  strategy: StrategyParametersSchema.optional(),
  userAddress: AddressSchema,
  createdAt: z.date(),
  expiresAt: z.date().optional(),
});

export const QuoteSchema = z.object({
  dex: z.string(),
  inputAmount: TokenAmountSchema,
  outputAmount: TokenAmountSchema,
  priceImpact: z.number().min(0),
  gasEstimate: z.string(), // bigint as string
  route: z.array(AddressSchema),
  calldata: z.string().regex(/^0x[a-fA-F0-9]*$/),
});

export const SwapParamsSchema = z.object({
  tokenIn: TokenSchema,
  tokenOut: TokenSchema,
  amountIn: z.string(), // Decimal as string
  slippage: z.number().min(0.01).max(30),
  userAddress: AddressSchema,
  deadline: z.number().int().positive().optional(),
});

export const ExecutionResultSchema = z.object({
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  status: z.enum(['pending', 'confirmed', 'failed', 'reverted']),
  gasUsed: z.string().optional(), // bigint as string
  effectiveGasPrice: z.string().optional(), // bigint as string
  blockNumber: z.number().int().positive().optional(),
  timestamp: z.date().optional(),
  inputAmount: TokenAmountSchema,
  outputAmount: TokenAmountSchema.optional(),
  error: z.string().optional(),
});

// Validation helper functions
export const validateTradingIntent = (data: unknown) => {
  return TradingIntentSchema.safeParse(data);
};

export const validateSwapParams = (data: unknown) => {
  return SwapParamsSchema.safeParse(data);
};

export const validateQuote = (data: unknown) => {
  return QuoteSchema.safeParse(data);
};