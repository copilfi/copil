import {
  ChatMessage,
  TradingIntent,
  MarketAnalysis,
  AIAgentResponse,
  PricePrediction,
  MarketOpportunity,
  RiskAlert,
} from '../types';

export interface IAIAgent {
  name: string;
  description: string;
  version: string;
  isActive: boolean;
  
  processMessage(message: string, context?: any): Promise<AIAgentResponse>;
  generateIntent(message: string): Promise<TradingIntent | null>;
  validateIntent(intent: TradingIntent): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    suggestions: string[];
  }>;
}

export interface IOrchestrator {
  registerAgent(agent: IAIAgent): void;
  unregisterAgent(agentName: string): void;
  
  processUserMessage(message: string, userId: string): Promise<{
    response: string;
    intent?: TradingIntent;
    agentUsed: string;
    confidence: number;
    executionSteps?: string[];
  }>;
  
  delegateToAgent(agentName: string, message: string, context?: any): Promise<AIAgentResponse>;
  
  getAvailableAgents(): IAIAgent[];
  getAgentCapabilities(): { [agentName: string]: string[] };
}

export interface ITradingAgent extends IAIAgent {
  analyzeMarket(tokens: string[]): Promise<MarketAnalysis>;
  suggestStrategy(
    portfolio: any,
    riskTolerance: 'conservative' | 'moderate' | 'aggressive'
  ): Promise<{
    strategies: TradingIntent[];
    rationale: string;
    expectedReturns: number[];
    riskAssessment: string;
  }>;
  
  optimizeExecution(intent: TradingIntent): Promise<{
    optimizedIntent: TradingIntent;
    improvements: string[];
    estimatedSavings: number;
  }>;
}

export interface IAnalyticsAgent extends IAIAgent {
  generatePricePredictions(
    tokens: string[],
    timeframes: string[]
  ): Promise<PricePrediction[]>;
  
  identifyOpportunities(
    marketConditions: any,
    userPreferences: any
  ): Promise<MarketOpportunity[]>;
  
  assessRisk(
    portfolio: any,
    proposedTrade: TradingIntent
  ): Promise<RiskAlert[]>;
  
  analyzePortfolioPerformance(
    portfolio: any,
    benchmark?: string
  ): Promise<{
    performance: any;
    insights: string[];
    recommendations: string[];
  }>;
}

export interface IPortfolioAgent extends IAIAgent {
  optimizeAllocation(
    currentPortfolio: any,
    targetAllocation: { [token: string]: number },
    constraints: any
  ): Promise<{
    rebalanceActions: TradingIntent[];
    expectedImprovement: number;
    rationale: string;
  }>;
  
  suggestRebalancing(
    portfolio: any,
    marketConditions: any
  ): Promise<{
    shouldRebalance: boolean;
    urgency: 'low' | 'medium' | 'high';
    suggestions: TradingIntent[];
    reasoning: string;
  }>;
  
  calculateOptimalPosition(
    token: string,
    portfolio: any,
    riskTolerance: number
  ): Promise<{
    recommendedAmount: number;
    confidenceLevel: number;
    riskRewardRatio: number;
    reasoning: string;
  }>;
}

export interface IRiskAgent extends IAIAgent {
  assessTradeRisk(intent: TradingIntent, portfolio: any): Promise<{
    riskScore: number; // 0-100
    riskFactors: string[];
    mitigation: string[];
    approval: 'approved' | 'warning' | 'rejected';
  }>;
  
  monitorPortfolioRisk(portfolio: any): Promise<{
    currentRisk: number;
    riskBreakdown: { [category: string]: number };
    alerts: RiskAlert[];
    recommendations: string[];
  }>;
  
  setRiskLimits(userId: string, limits: {
    maxPositionSize: number;
    maxDailyLoss: number;
    correlationLimit: number;
    leverageLimit?: number;
  }): Promise<void>;
  
  checkRiskLimits(userId: string, proposedTrade: TradingIntent): Promise<{
    withinLimits: boolean;
    violations: string[];
    adjustedTrade?: TradingIntent;
  }>;
}

export interface INLPProcessor {
  parseMessage(message: string): Promise<{
    intent: 'trade' | 'query' | 'analysis' | 'portfolio' | 'help';
    entities: { [key: string]: any };
    confidence: number;
    language: string;
  }>;
  
  extractTradingParameters(message: string): Promise<{
    action?: string;
    tokens?: { from?: string; to?: string };
    amount?: number;
    conditions?: any[];
    confidence: number;
  }>;
  
  generateResponse(
    data: any,
    messageType: 'success' | 'error' | 'info' | 'warning'
  ): Promise<string>;
  
  translateToUserLanguage(text: string, targetLanguage: string): Promise<string>;
}