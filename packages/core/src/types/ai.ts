import { Decimal } from 'decimal.js';
import { Token, TradingIntent } from './trading';

export type MessageRole = 'user' | 'assistant' | 'system';

export type AnalysisTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export type SentimentScore = -1 | -0.5 | 0 | 0.5 | 1;

export type SentimentLabel = 'very_bearish' | 'bearish' | 'neutral' | 'bullish' | 'very_bullish';

export type OpportunityType = 'arbitrage' | 'yield' | 'trend' | 'mean_reversion' | 'momentum';

export type RiskLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  intent?: TradingIntent;
  metadata?: {
    confidence?: number;
    processingTime?: number;
    model?: string;
  };
}

export interface SentimentSource {
  source: 'twitter' | 'reddit' | 'news' | 'discord' | 'telegram';
  score: SentimentScore;
  volume: number;
  timestamp: Date;
}

export interface MarketSentiment {
  token: Token;
  overall: SentimentLabel;
  score: SentimentScore;
  confidence: number;
  sources: SentimentSource[];
  trendingKeywords: string[];
  lastUpdated: Date;
}

export interface PricePrediction {
  token: Token;
  timeframe: AnalysisTimeframe;
  currentPrice: Decimal;
  predictedPrice: Decimal;
  confidence: number;
  factors: string[];
  model: string;
  timestamp: Date;
  accuracy?: number; // historical accuracy of this model
}

export interface MarketOpportunity {
  id: string;
  type: OpportunityType;
  description: string;
  expectedReturn: number; // percentage
  riskLevel: RiskLevel;
  confidence: number;
  timeHorizon: string;
  action: TradingIntent;
  metadata: {
    priceImpact?: number;
    liquidityDepth?: Decimal;
    historicalSuccessRate?: number;
    requiredCapital?: Decimal;
  };
  createdAt: Date;
  expiresAt?: Date;
}

export interface RiskAlert {
  id: string;
  level: RiskLevel;
  type: 'position_size' | 'correlation' | 'volatility' | 'liquidity' | 'market_conditions';
  message: string;
  affectedTokens: Token[];
  recommendedAction: string;
  severity: 1 | 2 | 3 | 4 | 5;
  timestamp: Date;
  acknowledged?: boolean;
}

export interface MarketAnalysis {
  timestamp: Date;
  predictions: PricePrediction[];
  sentiment: MarketSentiment[];
  opportunities: MarketOpportunity[];
  riskAlerts: RiskAlert[];
  marketConditions: {
    volatilityIndex: number;
    fearGreedIndex: number;
    liquidityIndex: number;
    trendStrength: number;
    correlationRisk: number;
  };
}

export interface AIAgentResponse {
  message: string;
  confidence: number;
  intent?: TradingIntent;
  analysis?: MarketAnalysis;
  recommendations?: string[];
  warnings?: string[];
  executionSteps?: string[];
}