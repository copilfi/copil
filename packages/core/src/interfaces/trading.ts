import { 
  Token, 
  TokenAmount, 
  Quote, 
  SwapParams, 
  ExecutionResult,
  TradingIntent,
  Address,
} from '../types';

export interface IDEXAdapter {
  name: string;
  isActive: boolean;
  
  getQuote(params: SwapParams): Promise<Quote | null>;
  executeSwap(quote: Quote, userAddress: Address): Promise<ExecutionResult>;
  getSupportedTokens(): Promise<Token[]>;
  getLiquidity(tokenA: Token, tokenB: Token): Promise<{
    reserveA: TokenAmount;
    reserveB: TokenAmount;
    totalLiquidityUSD: number;
  }>;
}

export interface IRouteOptimizer {
  findBestRoute(params: SwapParams): Promise<{
    bestQuote: Quote;
    allQuotes: Quote[];
    optimalDex: string;
    priceComparison: { [dex: string]: number };
  }>;
  
  findArbitrageOpportunities(
    tokenA: Token,
    tokenB: Token,
    amount: TokenAmount
  ): Promise<{
    opportunity: boolean;
    expectedProfit: number;
    route: Quote[];
    riskLevel: 'low' | 'medium' | 'high';
  }>;
}

export interface IStrategyEngine {
  evaluateConditions(intent: TradingIntent): Promise<boolean>;
  executeStrategy(intent: TradingIntent): Promise<ExecutionResult>;
  pauseStrategy(strategyId: string): Promise<void>;
  resumeStrategy(strategyId: string): Promise<void>;
  cancelStrategy(strategyId: string): Promise<void>;
  getStrategyStatus(strategyId: string): Promise<{
    isActive: boolean;
    nextEvaluation?: Date;
    executionCount: number;
    lastExecution?: Date;
    performance: {
      totalProfitLoss: number;
      successRate: number;
      averageExecutionTime: number;
    };
  }>;
}

export interface IPriceOracle {
  getPrice(token: Token): Promise<{
    price: number;
    timestamp: Date;
    source: string;
    confidence: number;
  }>;
  
  getPriceHistory(
    token: Token, 
    timeframe: '1m' | '5m' | '1h' | '4h' | '1d',
    limit: number
  ): Promise<Array<{
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>;
  
  subscribeToPriceUpdates(
    tokens: Token[],
    callback: (token: Token, price: number) => void
  ): () => void; // Returns unsubscribe function
}

export interface IOrderBookProvider {
  getOrderBook(tokenA: Token, tokenB: Token): Promise<{
    bids: Array<{ price: number; quantity: number }>;
    asks: Array<{ price: number; quantity: number }>;
    spread: number;
    lastUpdate: Date;
  }>;
  
  getMarketDepth(tokenA: Token, tokenB: Token): Promise<{
    depth: number; // USD depth
    priceImpact: { [amount: string]: number }; // Amount -> price impact %
  }>;
}