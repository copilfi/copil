import { Decimal } from 'decimal.js';

export type Address = `0x${string}`;

export type TokenAddress = Address;

export type ChainId = number;

export type TradingAction = 'swap' | 'limit_order' | 'yield_farm' | 'provide_liquidity';

export type ConditionType = 'price' | 'time' | 'volume' | 'custom';

export type ConditionOperator = '>' | '<' | '==' | '>=' | '<=';

export type StrategyType = 
  | 'simple_swap'
  | 'conditional_order'
  | 'dca'
  | 'yield_optimization'
  | 'arbitrage'
  | 'portfolio_rebalancing';

export type OrderStatus = 
  | 'pending'
  | 'active'
  | 'executing'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type TransactionStatus =
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'reverted';

export interface Token {
  address: TokenAddress;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  coingeckoId?: string;
}

export interface TokenAmount {
  token: Token;
  amount: Decimal;
  amountRaw: bigint;
}

export interface TradingCondition {
  type: ConditionType;
  operator: ConditionOperator;
  value: number | string;
  chainlinkOracle?: Address;
  pythPriceId?: string;
}

export interface DCAParameters {
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  amount: Decimal;
  totalOrders: number;
  currentOrder: number;
}

export interface StrategyParameters {
  stopLoss?: number;
  takeProfit?: number;
  slippage: number;
  dca?: DCAParameters;
  maxGasPrice?: Decimal;
}

export interface TradingIntent {
  id: string;
  action: TradingAction;
  tokens: {
    from: Token;
    to: Token;
  };
  amount: TokenAmount;
  conditions?: TradingCondition[];
  strategy?: StrategyParameters;
  userAddress: Address;
  createdAt: Date;
  expiresAt?: Date;
}

export interface Quote {
  dex: string;
  inputAmount: TokenAmount;
  outputAmount: TokenAmount;
  priceImpact: number;
  gasEstimate: bigint;
  route: Address[];
  calldata: `0x${string}`;
}

export interface SwapParams {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: Decimal;
  slippage: number;
  userAddress: Address;
  deadline?: number;
}

export interface ExecutionResult {
  transactionHash: `0x${string}`;
  status: TransactionStatus;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  blockNumber?: number;
  timestamp?: Date;
  inputAmount: TokenAmount;
  outputAmount?: TokenAmount;
  error?: string;
}