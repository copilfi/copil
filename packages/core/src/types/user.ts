import { Address } from './trading';

export interface User {
  id: string;
  walletAddress: Address;
  smartAccountAddress?: Address;
  email?: string;
  username?: string;
  createdAt: Date;
  lastLoginAt?: Date;
  isActive: boolean;
  preferences: UserPreferences;
  subscription?: UserSubscription;
  kycStatus: KYCStatus;
}

export interface UserPreferences {
  defaultSlippage: number;
  maxGasPrice: number;
  notifications: NotificationPreferences;
  trading: TradingPreferences;
  ui: UIPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  discord?: boolean;
  telegram?: boolean;
  strategies: {
    executed: boolean;
    failed: boolean;
    triggered: boolean;
  };
  portfolio: {
    dailySummary: boolean;
    largeMovements: boolean;
    rebalanceAlerts: boolean;
  };
  market: {
    priceAlerts: boolean;
    opportunities: boolean;
    riskAlerts: boolean;
  };
}

export interface TradingPreferences {
  autoApproveSmallTrades: boolean;
  smallTradeThreshold: number; // USD
  requireConfirmationFor: {
    largeOrders: boolean;
    newStrategies: boolean;
    highRiskTrades: boolean;
  };
  defaultTimeouts: {
    swapDeadline: number; // minutes
    strategyExpiration: number; // hours
  };
  riskManagement: {
    maxPositionSize: number; // percentage of portfolio
    maxDailyLoss: number; // percentage
    stopLossDefault: number; // percentage
  };
}

export interface UIPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  currency: 'USD' | 'EUR' | 'BTC' | 'ETH';
  chartType: 'candlestick' | 'line' | 'area';
  defaultTimeframe: '1h' | '4h' | '1d' | '1w';
  showAdvancedFeatures: boolean;
}

export type SubscriptionTier = 'free' | 'pro' | 'premium' | 'enterprise';

export interface UserSubscription {
  tier: SubscriptionTier;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  autoRenew: boolean;
  limits: SubscriptionLimits;
}

export interface SubscriptionLimits {
  maxActiveStrategies: number;
  maxMonthlyVolume: number; // USD
  aiRequestsPerDay: number;
  advancedAnalytics: boolean;
  prioritySupport: boolean;
  customIndicators: boolean;
}

export type KYCStatus = 'none' | 'pending' | 'verified' | 'rejected';

export interface SessionKey {
  address: Address;
  validUntil: Date;
  validAfter: Date;
  limitAmount: bigint;
  allowedTargets: Address[];
  allowedFunctions: string[]; // function selectors
  isActive: boolean;
  createdAt: Date;
  lastUsed?: Date;
  usageCount: number;
}

export interface UserSession {
  id: string;
  userId: string;
  token: string;
  refreshToken?: string;
  expiresAt: Date;
  createdAt: Date;
  lastActiveAt: Date;
  ipAddress: string;
  userAgent: string;
  sessionKeys: SessionKey[];
  isActive: boolean;
}