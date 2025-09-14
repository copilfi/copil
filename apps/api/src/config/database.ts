import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import env from './env';

class Database {
  private static instance: Database;
  public prisma: PrismaClient;

  private constructor() {
    this.prisma = new PrismaClient({
      log: env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
      datasources: {
        db: {
          url: env.DATABASE_URL,
        },
      },
      // Production optimizations
      ...(env.NODE_ENV === 'production' && {
        transactionOptions: {
          maxWait: 5000, // 5 seconds
          timeout: 10000, // 10 seconds
        },
      }),
    });
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      
      // Set connection pool optimization
      if (env.NODE_ENV === 'production') {
        await this.prisma.$executeRaw`
          SET statement_timeout = '30s';
          SET lock_timeout = '10s';
          SET idle_in_transaction_session_timeout = '5min';
        `;
      }
      
      logger.info('📦 Database connected successfully');
    } catch (error) {
      logger.error('❌ Database connection failed:', error);
      process.exit(1);
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      logger.info('📦 Database disconnected');
    } catch (error) {
      logger.error('❌ Database disconnection failed:', error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]);
      return true;
    } catch (error) {
      logger.error('❌ Database health check failed:', error);
      return false;
    }
  }

  async getConnectionInfo(): Promise<{
    status: string;
    connectionCount: number;
    version: string;
  }> {
    try {
      const [statusResult, connectionResult, versionResult] = await Promise.all([
        this.prisma.$queryRaw`SELECT current_setting('server_version_num') as version_num`,
        this.prisma.$queryRaw`SELECT count(*) as connection_count FROM pg_stat_activity`,
        this.prisma.$queryRaw`SELECT version() as version`
      ]);
      
      return {
        status: 'connected',
        connectionCount: Number((connectionResult as any)[0]?.connection_count || 0),
        version: (versionResult as any)[0]?.version || 'unknown'
      };
    } catch (error) {
      logger.error('❌ Failed to get database connection info:', error);
      return {
        status: 'error',
        connectionCount: 0,
        version: 'unknown'
      };
    }
  }

  async optimizeForPerformance(): Promise<void> {
    if (env.NODE_ENV !== 'production') return;
    
    try {
      // Enable connection pooling optimizations
      await this.prisma.$executeRaw`SET max_connections = 200`;
      await this.prisma.$executeRaw`SET shared_buffers = '256MB'`;
      await this.prisma.$executeRaw`SET effective_cache_size = '1GB'`;
      await this.prisma.$executeRaw`SET work_mem = '16MB'`;
      await this.prisma.$executeRaw`SET maintenance_work_mem = '128MB'`;
      
      logger.info('📊 Database performance optimization applied');
    } catch (error) {
      logger.warn('⚠️ Database performance optimization failed:', error);
    }
  }
}

export const database = Database.getInstance();
export const prisma = database.prisma;
export default database;