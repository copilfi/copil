import { logger } from '@/utils/logger';
import { User, SmartAccount, SessionKey, Transaction, BlockchainEvent, Strategy } from '@/types';

// Mock Prisma client for development when database package is not ready
class MockPrismaClient {
  user = {
    findUnique: async (params: any): Promise<User | null> => {
      logger.info('Mock: Finding user with params:', params);
      return null; // User not found
    },
    create: async (params: any): Promise<User> => {
      logger.info('Mock: Creating user with params:', params);
      return {
        id: 'mock-user-id',
        address: params.data.address,
        email: params.data.email,
        createdAt: new Date(),
        preferences: params.data.preferences || {}
      };
    },
    update: async (params: any) => {
      logger.info('Mock: Updating user with params:', params);
      return {
        id: params.where.id,
        address: 'mock-address',
        email: 'mock@email.com',
        lastLoginAt: new Date(),
        preferences: params.data.preferences || {}
      };
    }
  };

  smartAccount = {
    findFirst: async (params: any) => {
      logger.info('Mock: Finding smart account with params:', params);
      return null;
    },
    create: async (params: any) => {
      logger.info('Mock: Creating smart account with params:', params);
      return {
        id: 'mock-smart-account-id',
        address: params.data.address,
        userId: params.data.userId,
        isActive: params.data.isActive,
        createdAt: new Date()
      };
    },
    upsert: async (params: any) => {
      logger.info('Mock: Upserting smart account with params:', params);
      return {
        id: 'mock-smart-account-id',
        address: params.where.address || 'mock-address',
        userId: 'mock-user-id',
        isActive: true,
        createdAt: new Date()
      };
    },
    updateMany: async (params: any) => {
      logger.info('Mock: Updating many smart accounts with params:', params);
      return { count: 1 };
    }
  };

  sessionKey = {
    findMany: async (params: any) => {
      logger.info('Mock: Finding many session keys with params:', params);
      return [];
    },
    create: async (params: any) => {
      logger.info('Mock: Creating session key with params:', params);
      return {
        id: 'mock-session-key-id',
        sessionKey: params.data.sessionKey,
        validUntil: params.data.validUntil,
        limitAmount: params.data.limitAmount,
        description: params.data.description,
        createdAt: new Date()
      };
    },
    updateMany: async (params: any) => {
      logger.info('Mock: Updating many session keys with params:', params);
      return { count: 1 };
    },
    count: async (params: any) => {
      logger.info('Mock: Counting session keys with params:', params);
      return 0;
    }
  };

  transaction = {
    create: async (params: any) => {
      logger.info('Mock: Creating transaction with params:', params);
      return {
        id: 'mock-transaction-id',
        hash: params.data.hash,
        userId: params.data.userId,
        type: params.data.type,
        status: params.data.status,
        details: params.data.details,
        createdAt: new Date()
      };
    }
  };

  blockchainEvent = {
    findFirst: async (params: any) => {
      logger.info('Mock: Finding blockchain event with params:', params);
      return null;
    },
    upsert: async (params: any) => {
      logger.info('Mock: Upserting blockchain event with params:', params);
      return {
        id: 'mock-event-id',
        contractAddress: params.create.contractAddress,
        eventName: params.create.eventName,
        blockNumber: params.create.blockNumber,
        transactionHash: params.create.transactionHash,
        logIndex: params.create.logIndex,
        args: params.create.args,
        timestamp: params.create.timestamp,
        processed: params.create.processed,
        processedAt: params.create.processedAt,
        blockHash: params.create.blockHash
      };
    }
  };

  strategy = {
    findFirst: async (params: any) => {
      logger.info('Mock: Finding strategy with params:', params);
      return null;
    },
    update: async (params: any) => {
      logger.info('Mock: Updating strategy with params:', params);
      return {
        id: params.where.id,
        name: 'Mock Strategy',
        status: params.data.status,
        conditionalOrderId: params.data.conditionalOrderId,
        completedAt: params.data.completedAt,
        userId: 'mock-user-id'
      };
    }
  };

  async $connect() {
    logger.info('📦 Mock Database connected');
  }

  async $disconnect() {
    logger.info('📦 Mock Database disconnected');
  }

  async $queryRaw(query: any) {
    logger.info('Mock: Executing raw query:', query);
    return [{ result: 1 }];
  }
}

class MockDatabase {
  private static instance: MockDatabase;
  public prisma: MockPrismaClient;

  private constructor() {
    this.prisma = new MockPrismaClient();
  }

  static getInstance(): MockDatabase {
    if (!MockDatabase.instance) {
      MockDatabase.instance = new MockDatabase();
    }
    return MockDatabase.instance;
  }

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('❌ Mock Database health check failed:', error);
      return false;
    }
  }
}

export const database = MockDatabase.getInstance();
export const prisma = database.prisma;
export default database;