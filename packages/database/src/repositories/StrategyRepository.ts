import { PrismaClient, Strategy, StrategyType, Transaction } from '@prisma/client';
import { TradingIntent } from '@copil/core';

export class StrategyRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    userId: string;
    name: string;
    type: StrategyType;
    description?: string;
    conditions: any[];
    parameters: any;
    expiresAt?: Date;
  }): Promise<Strategy> {
    return this.prisma.strategy.create({
      data,
    });
  }

  async findById(id: string): Promise<Strategy | null> {
    return this.prisma.strategy.findUnique({
      where: { id },
      include: {
        user: true,
        transactions: {
          orderBy: { executedAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async findByUserId(
    userId: string,
    options?: {
      isActive?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<Strategy[]> {
    const { isActive, limit = 50, offset = 0 } = options || {};

    return this.prisma.strategy.findMany({
      where: {
        userId,
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        transactions: {
          orderBy: { executedAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async findActiveStrategies(): Promise<Strategy[]> {
    return this.prisma.strategy.findMany({
      where: {
        isActive: true,
        OR: [
          { expiresAt: { gt: new Date() } },
          { expiresAt: null },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            smartAccountAddress: true,
            preferences: true,
          },
        },
      },
    });
  }

  async findDueForExecution(): Promise<Strategy[]> {
    // This would require more complex logic based on conditions
    // For now, return active strategies that haven't been executed recently
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    return this.prisma.strategy.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [
              { lastExecutedAt: null },
              { lastExecutedAt: { lt: oneHourAgo } },
            ]
          },
          {
            OR: [
              { expiresAt: { gt: new Date() } },
              { expiresAt: null },
            ]
          }
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            smartAccountAddress: true,
            preferences: true,
          },
        },
      },
    });
  }

  async update(id: string, data: Partial<{
    name: string;
    description: string;
    conditions: any[];
    parameters: any;
    isActive: boolean;
    expiresAt: Date;
  }>): Promise<Strategy> {
    return this.prisma.strategy.update({
      where: { id },
      data,
    });
  }

  async markExecuted(id: string): Promise<Strategy> {
    return this.prisma.strategy.update({
      where: { id },
      data: {
        lastExecutedAt: new Date(),
        executedCount: {
          increment: 1,
        },
      },
    });
  }

  async pause(id: string): Promise<Strategy> {
    return this.prisma.strategy.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async resume(id: string): Promise<Strategy> {
    return this.prisma.strategy.update({
      where: { id },
      data: { isActive: true },
    });
  }

  async delete(id: string): Promise<Strategy> {
    return this.prisma.strategy.delete({
      where: { id },
    });
  }

  async getPerformanceStats(id: string): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    totalVolume: string;
    averageExecutionTime: number;
    lastExecution?: Date;
  }> {
    const [strategy, transactionStats] = await Promise.all([
      this.prisma.strategy.findUnique({
        where: { id },
        select: {
          executedCount: true,
          lastExecutedAt: true,
        },
      }),
      this.prisma.transaction.groupBy({
        by: ['status'],
        where: { strategyId: id },
        _count: true,
      }),
    ]);

    const successfulExecutions = transactionStats.find(
      group => group.status === 'CONFIRMED'
    )?._count || 0;

    const failedExecutions = transactionStats.find(
      group => group.status === 'FAILED' || group.status === 'REVERTED'
    )?._count || 0;

    return {
      totalExecutions: strategy?.executedCount || 0,
      successfulExecutions,
      failedExecutions,
      totalVolume: '0', // Would need custom calculation
      averageExecutionTime: 0, // Would need custom calculation
      lastExecution: strategy?.lastExecutedAt || undefined,
    };
  }

  async getUserStrategyStats(userId: string): Promise<{
    total: number;
    active: number;
    paused: number;
    byType: { [key in StrategyType]: number };
  }> {
    const [totalCount, activeCount, pausedCount, typeStats] = await Promise.all([
      this.prisma.strategy.count({ where: { userId } }),
      this.prisma.strategy.count({ where: { userId, isActive: true } }),
      this.prisma.strategy.count({ where: { userId, isActive: false } }),
      this.prisma.strategy.groupBy({
        by: ['type'],
        where: { userId },
        _count: true,
      }),
    ]);

    const byType = {} as { [key in StrategyType]: number };
    for (const type of Object.values(StrategyType)) {
      byType[type] = typeStats.find(stat => stat.type === type)?._count || 0;
    }

    return {
      total: totalCount,
      active: activeCount,
      paused: pausedCount,
      byType,
    };
  }

  async cleanupExpiredStrategies(): Promise<number> {
    const result = await this.prisma.strategy.updateMany({
      where: {
        isActive: true,
        expiresAt: { lt: new Date() },
      },
      data: { isActive: false },
    });

    return result.count;
  }
}