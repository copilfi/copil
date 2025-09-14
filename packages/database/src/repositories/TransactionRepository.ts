import { PrismaClient, Transaction, TransactionType, TransactionStatus } from '@prisma/client';

export class TransactionRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    userId: string;
    strategyId?: string;
    txHash: string;
    type: TransactionType;
    tokensIn: any;
    tokensOut?: any;
    gasUsed?: string;
    gasPrice?: string;
    blockNumber?: number;
  }): Promise<Transaction> {
    return this.prisma.transaction.create({
      data: {
        ...data,
        status: 'PENDING',
      },
    });
  }

  async findByTxHash(txHash: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({
      where: { txHash },
      include: {
        user: true,
        strategy: true,
      },
    });
  }

  async findByUserId(
    userId: string,
    options?: {
      status?: TransactionStatus;
      type?: TransactionType;
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<Transaction[]> {
    const {
      status,
      type,
      limit = 50,
      offset = 0,
      startDate,
      endDate,
    } = options || {};

    return this.prisma.transaction.findMany({
      where: {
        userId,
        ...(status && { status }),
        ...(type && { type }),
        ...(startDate && endDate && {
          executedAt: {
            gte: startDate,
            lte: endDate,
          },
        }),
      },
      include: {
        strategy: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: { executedAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async findByStrategyId(
    strategyId: string,
    options?: {
      status?: TransactionStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<Transaction[]> {
    const { status, limit = 50, offset = 0 } = options || {};

    return this.prisma.transaction.findMany({
      where: {
        strategyId,
        ...(status && { status }),
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { executedAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async updateStatus(
    txHash: string,
    data: {
      status: TransactionStatus;
      blockNumber?: number;
      gasUsed?: string;
      gasPrice?: string;
      confirmedAt?: Date;
      tokensOut?: any;
      error?: string;
    }
  ): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { txHash },
      data: {
        ...data,
        ...(data.status === 'CONFIRMED' && !data.confirmedAt && {
          confirmedAt: new Date(),
        }),
      },
    });
  }

  async getPendingTransactions(olderThanMinutes: number = 30): Promise<Transaction[]> {
    const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    return this.prisma.transaction.findMany({
      where: {
        status: 'PENDING',
        executedAt: { lt: cutoffTime },
      },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
        strategy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async getTransactionStats(
    userId?: string,
    timeframe?: {
      startDate: Date;
      endDate: Date;
    }
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    pending: number;
    totalVolume: string;
    byType: { [key in TransactionType]: number };
  }> {
    const where = {
      ...(userId && { userId }),
      ...(timeframe && {
        executedAt: {
          gte: timeframe.startDate,
          lte: timeframe.endDate,
        },
      }),
    };

    const [statusStats, typeStats, totalCount] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where,
        _count: true,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const successful = statusStats.find(stat => stat.status === 'CONFIRMED')?._count || 0;
    const failed = statusStats.filter(
      stat => stat.status === 'FAILED' || stat.status === 'REVERTED'
    ).reduce((sum, stat) => sum + stat._count, 0);
    const pending = statusStats.find(stat => stat.status === 'PENDING')?._count || 0;

    const byType = {} as { [key in TransactionType]: number };
    for (const type of Object.values(TransactionType)) {
      byType[type] = typeStats.find(stat => stat.type === type)?._count || 0;
    }

    return {
      total: totalCount,
      successful,
      failed,
      pending,
      totalVolume: '0', // Would need custom calculation from JSON fields
      byType,
    };
  }

  async getDailyTransactionVolume(
    userId?: string,
    days: number = 30
  ): Promise<Array<{
    date: string;
    count: number;
    volume: string;
  }>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // This would need raw SQL for proper date grouping and JSON field aggregation
    // For now, return empty array as placeholder
    return [];
  }

  async getTopTradingPairs(
    userId?: string,
    limit: number = 10
  ): Promise<Array<{
    tokenIn: string;
    tokenOut: string;
    count: number;
    volume: string;
  }>> {
    // This would need complex JSON field queries
    // For now, return empty array as placeholder
    return [];
  }

  async cleanupOldPendingTransactions(olderThanHours: number = 24): Promise<number> {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

    const result = await this.prisma.transaction.updateMany({
      where: {
        status: 'PENDING',
        executedAt: { lt: cutoffTime },
      },
      data: {
        status: 'FAILED',
        error: 'Transaction timed out',
      },
    });

    return result.count;
  }
}