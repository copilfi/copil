import { z } from 'zod';
import { AddressSchema } from './trading';

export const UserPreferencesSchema = z.object({
  defaultSlippage: z.number().min(0.01).max(30),
  maxGasPrice: z.number().positive(),
  notifications: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
    discord: z.boolean().optional(),
    telegram: z.boolean().optional(),
    strategies: z.object({
      executed: z.boolean(),
      failed: z.boolean(),
      triggered: z.boolean(),
    }),
    portfolio: z.object({
      dailySummary: z.boolean(),
      largeMovements: z.boolean(),
      rebalanceAlerts: z.boolean(),
    }),
    market: z.object({
      priceAlerts: z.boolean(),
      opportunities: z.boolean(),
      riskAlerts: z.boolean(),
    }),
  }),
  trading: z.object({
    autoApproveSmallTrades: z.boolean(),
    smallTradeThreshold: z.number().min(0),
    requireConfirmationFor: z.object({
      largeOrders: z.boolean(),
      newStrategies: z.boolean(),
      highRiskTrades: z.boolean(),
    }),
    defaultTimeouts: z.object({
      swapDeadline: z.number().int().positive(),
      strategyExpiration: z.number().int().positive(),
    }),
    riskManagement: z.object({
      maxPositionSize: z.number().min(0).max(100),
      maxDailyLoss: z.number().min(0).max(100),
      stopLossDefault: z.number().min(0).max(100),
    }),
  }),
  ui: z.object({
    theme: z.enum(['light', 'dark', 'system']),
    language: z.string().min(2).max(10),
    currency: z.enum(['USD', 'EUR', 'BTC', 'ETH']),
    chartType: z.enum(['candlestick', 'line', 'area']),
    defaultTimeframe: z.enum(['1h', '4h', '1d', '1w']),
    showAdvancedFeatures: z.boolean(),
  }),
});

export const SubscriptionLimitsSchema = z.object({
  maxActiveStrategies: z.number().int().min(0),
  maxMonthlyVolume: z.number().min(0),
  aiRequestsPerDay: z.number().int().min(0),
  advancedAnalytics: z.boolean(),
  prioritySupport: z.boolean(),
  customIndicators: z.boolean(),
});

export const UserSubscriptionSchema = z.object({
  tier: z.enum(['free', 'pro', 'premium', 'enterprise']),
  startDate: z.date(),
  endDate: z.date(),
  isActive: z.boolean(),
  autoRenew: z.boolean(),
  limits: SubscriptionLimitsSchema,
});

export const UserSchema = z.object({
  id: z.string().uuid(),
  walletAddress: AddressSchema,
  smartAccountAddress: AddressSchema.optional(),
  email: z.string().email().optional(),
  username: z.string().min(3).max(50).optional(),
  createdAt: z.date(),
  lastLoginAt: z.date().optional(),
  isActive: z.boolean(),
  preferences: UserPreferencesSchema,
  subscription: UserSubscriptionSchema.optional(),
  kycStatus: z.enum(['none', 'pending', 'verified', 'rejected']),
});

export const SessionKeySchema = z.object({
  address: AddressSchema,
  validUntil: z.date(),
  validAfter: z.date(),
  limitAmount: z.string(), // bigint as string
  allowedTargets: z.array(AddressSchema),
  allowedFunctions: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.date(),
  lastUsed: z.date().optional(),
  usageCount: z.number().int().min(0),
});

export const UserSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  token: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.date(),
  createdAt: z.date(),
  lastActiveAt: z.date(),
  ipAddress: z.string().ip(),
  userAgent: z.string(),
  sessionKeys: z.array(SessionKeySchema),
  isActive: z.boolean(),
});

// Validation helper functions
export const validateUser = (data: unknown) => {
  return UserSchema.safeParse(data);
};

export const validateUserPreferences = (data: unknown) => {
  return UserPreferencesSchema.safeParse(data);
};

export const validateSessionKey = (data: unknown) => {
  return SessionKeySchema.safeParse(data);
};