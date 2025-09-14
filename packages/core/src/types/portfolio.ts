import { Decimal } from 'decimal.js';
import { Address, Token, TokenAmount } from './trading';

export interface Asset {
  token: Token;
  balance: TokenAmount;
  valueUSD: Decimal;
  allocation: number; // percentage
  averageCost?: Decimal;
  unrealizedPnL?: Decimal;
  realizedPnL?: Decimal;
}

export interface PortfolioPerformance {
  timeframe: '1h' | '4h' | '1d' | '1w' | '1m' | '3m' | '1y' | 'all';
  return: number; // percentage
  returnUSD: Decimal;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  winRate: number;
}

export interface RiskMetrics {
  portfolioValue: Decimal;
  dailyVaR: Decimal; // Value at Risk
  weeklyVaR: Decimal;
  beta: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  calmarRatio: number;
  concentrationRisk: number;
  correlationMatrix: { [key: string]: { [key: string]: number } };
}

export interface Portfolio {
  id: string;
  userAddress: Address;
  name: string;
  totalValue: Decimal;
  totalValueChange24h: Decimal;
  totalValueChangePercent24h: number;
  assets: Asset[];
  performance: { [K in PortfolioPerformance['timeframe']]: PortfolioPerformance };
  riskMetrics: RiskMetrics;
  lastUpdated: Date;
  createdAt: Date;
}

export interface PortfolioRebalanceTarget {
  token: Token;
  targetAllocation: number; // percentage
  currentAllocation: number;
  rebalanceAmount: Decimal;
  rebalanceDirection: 'buy' | 'sell';
}

export interface RebalanceStrategy {
  id: string;
  name: string;
  targets: PortfolioRebalanceTarget[];
  threshold: number; // rebalance when allocation differs by this percentage
  frequency: 'manual' | 'hourly' | 'daily' | 'weekly' | 'monthly';
  isActive: boolean;
  lastRebalance?: Date;
  nextRebalance?: Date;
}