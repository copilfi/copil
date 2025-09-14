import { PrismaClient, User, UserSubscription, UserSession } from '@prisma/client';
import { Address } from '@copil/core';

export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findByWalletAddress(walletAddress: Address): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { walletAddress },
      include: {
        subscriptions: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async create(data: {
    walletAddress: Address;
    smartAccountAddress?: Address;
    email?: string;
    username?: string;
    preferences?: any;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        ...data,
        preferences: data.preferences || this.getDefaultPreferences(),
      },
    });
  }

  async updateLastLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async updatePreferences(id: string, preferences: any): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { preferences },
    });
  }

  async updateSmartAccountAddress(id: string, smartAccountAddress: Address): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { smartAccountAddress },
    });
  }

  async deactivate(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async createSession(data: {
    userId: string;
    token: string;
    refreshToken?: string;
    expiresAt: Date;
    ipAddress: string;
    userAgent: string;
  }): Promise<UserSession> {
    return this.prisma.userSession.create({
      data,
    });
  }

  async findSessionByToken(token: string): Promise<UserSession | null> {
    return this.prisma.userSession.findUnique({
      where: { token },
      include: {
        user: true,
        sessionKeys: true,
      },
    });
  }

  async deactivateSession(token: string): Promise<UserSession> {
    return this.prisma.userSession.update({
      where: { token },
      data: { isActive: false },
    });
  }

  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { lastActiveAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, // 7 days inactive
        ],
      },
      data: { isActive: false },
    });

    return result.count;
  }

  async getUserStats(id: string): Promise<{
    totalStrategies: number;
    activeStrategies: number;
    totalTransactions: number;
    totalVolume: string;
  }> {
    const [strategyCounts, transactionStats] = await Promise.all([
      this.prisma.strategy.groupBy({
        by: ['isActive'],
        where: { userId: id },
        _count: true,
      }),
      this.prisma.transaction.aggregate({
        where: { userId: id, status: 'CONFIRMED' },
        _count: true,
      }),
    ]);

    const totalStrategies = strategyCounts.reduce((sum, group) => sum + group._count, 0);
    const activeStrategies = strategyCounts.find(group => group.isActive)?._count || 0;

    return {
      totalStrategies,
      activeStrategies,
      totalTransactions: transactionStats._count || 0,
      totalVolume: '0', // Would need custom calculation from JSON fields
    };
  }

  private getDefaultPreferences() {
    return {
      defaultSlippage: 0.5,
      maxGasPrice: 20,
      notifications: {
        email: true,
        sms: false,
        push: true,
        discord: false,
        telegram: false,
        strategies: {
          executed: true,
          failed: true,
          triggered: true,
        },
        portfolio: {
          dailySummary: true,
          largeMovements: true,
          rebalanceAlerts: true,
        },
        market: {
          priceAlerts: true,
          opportunities: true,
          riskAlerts: true,
        },
      },
      trading: {
        autoApproveSmallTrades: false,
        smallTradeThreshold: 100,
        requireConfirmationFor: {
          largeOrders: true,
          newStrategies: true,
          highRiskTrades: true,
        },
        defaultTimeouts: {
          swapDeadline: 20,
          strategyExpiration: 24,
        },
        riskManagement: {
          maxPositionSize: 25,
          maxDailyLoss: 5,
          stopLossDefault: 10,
        },
      },
      ui: {
        theme: 'dark',
        language: 'en',
        currency: 'USD',
        chartType: 'candlestick',
        defaultTimeframe: '1d',
        showAdvancedFeatures: false,
      },
    };
  }
}