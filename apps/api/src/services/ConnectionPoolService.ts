import { logger } from '@/utils/logger';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import env from '@/config/env';

export interface PoolStats {
  database: {
    active: number;
    idle: number;
    total: number;
    maxConnections: number;
  };
  redis: {
    status: string;
    connectedClients: number;
    maxClients: number;
  };
}

export interface ConnectionHealth {
  database: {
    healthy: boolean;
    latency: number;
    errorRate: number;
  };
  redis: {
    healthy: boolean;
    latency: number;
    errorRate: number;
  };
}

export class ConnectionPoolService {
  private databaseErrorCount = 0;
  private redisErrorCount = 0;
  private totalDbRequests = 0;
  private totalRedisRequests = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaClient,
    private redis?: Redis
  ) {
    this.startHealthChecking();
    logger.info('🏊 Connection Pool Service initialized');
  }

  /**
   * Start periodic health checking
   */
  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop health checking
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get connection pool statistics
   */
  async getPoolStats(): Promise<PoolStats> {
    try {
      // Database connection stats
      const dbStats = await this.getDatabaseStats();
      
      // Redis connection stats
      const redisStats = await this.getRedisStats();

      return {
        database: dbStats,
        redis: redisStats
      };

    } catch (error) {
      logger.error('Error getting pool stats:', error);
      return {
        database: {
          active: 0,
          idle: 0,
          total: 0,
          maxConnections: 0
        },
        redis: {
          status: 'error',
          connectedClients: 0,
          maxClients: 0
        }
      };
    }
  }

  /**
   * Get database connection statistics
   */
  private async getDatabaseStats(): Promise<PoolStats['database']> {
    try {
      const connectionInfo = await this.prisma.$queryRaw<Array<{
        state: string;
        count: number;
      }>>`
        SELECT 
          state,
          COUNT(*) as count
        FROM pg_stat_activity 
        WHERE datname = current_database()
        GROUP BY state
      `;

      const maxConnections = await this.prisma.$queryRaw<Array<{
        setting: string;
      }>>`
        SELECT setting 
        FROM pg_settings 
        WHERE name = 'max_connections'
      `;

      let active = 0;
      let idle = 0;

      connectionInfo.forEach(({ state, count }) => {
        if (state === 'active') {
          active = Number(count);
        } else if (state === 'idle') {
          idle = Number(count);
        }
      });

      const total = active + idle;
      const maxConn = Number(maxConnections[0]?.setting || 0);

      return {
        active,
        idle,
        total,
        maxConnections: maxConn
      };

    } catch (error) {
      logger.error('Error getting database stats:', error);
      this.databaseErrorCount++;
      return {
        active: 0,
        idle: 0,
        total: 0,
        maxConnections: 0
      };
    }
  }

  /**
   * Get Redis connection statistics
   */
  private async getRedisStats(): Promise<PoolStats['redis']> {
    if (!this.redis) {
      return {
        status: 'not_configured',
        connectedClients: 0,
        maxClients: 0
      };
    }

    try {
      const info = await this.redis.info('clients');
      const lines = info.split('\r\n');
      
      let connectedClients = 0;
      let maxClients = 0;

      lines.forEach(line => {
        if (line.startsWith('connected_clients:')) {
          connectedClients = parseInt(line.split(':')[1], 10);
        } else if (line.startsWith('maxclients:')) {
          maxClients = parseInt(line.split(':')[1], 10);
        }
      });

      return {
        status: this.redis.status,
        connectedClients,
        maxClients
      };

    } catch (error) {
      logger.error('Error getting Redis stats:', error);
      this.redisErrorCount++;
      return {
        status: 'error',
        connectedClients: 0,
        maxClients: 0
      };
    }
  }

  /**
   * Perform health check on connections
   */
  private async performHealthCheck(): Promise<ConnectionHealth> {
    const startTime = Date.now();
    
    // Database health check
    const dbHealth = await this.checkDatabaseHealth();
    
    // Redis health check
    const redisHealth = await this.checkRedisHealth();

    const healthResult: ConnectionHealth = {
      database: dbHealth,
      redis: redisHealth
    };

    const totalTime = Date.now() - startTime;
    logger.debug(`Health check completed in ${totalTime}ms`, healthResult);

    // Log warnings for unhealthy connections
    if (!dbHealth.healthy) {
      logger.warn('⚠️ Database connection is unhealthy', {
        latency: dbHealth.latency,
        errorRate: dbHealth.errorRate
      });
    }

    if (!redisHealth.healthy) {
      logger.warn('⚠️ Redis connection is unhealthy', {
        latency: redisHealth.latency,
        errorRate: redisHealth.errorRate
      });
    }

    return healthResult;
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<ConnectionHealth['database']> {
    const startTime = Date.now();
    
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - startTime;
      this.totalDbRequests++;

      const errorRate = this.totalDbRequests > 0 ? 
        (this.databaseErrorCount / this.totalDbRequests) * 100 : 0;

      return {
        healthy: latency < 1000 && errorRate < 5, // Healthy if latency < 1s and error rate < 5%
        latency,
        errorRate
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      this.databaseErrorCount++;
      this.totalDbRequests++;

      const errorRate = (this.databaseErrorCount / this.totalDbRequests) * 100;

      return {
        healthy: false,
        latency,
        errorRate
      };
    }
  }

  /**
   * Check Redis health
   */
  private async checkRedisHealth(): Promise<ConnectionHealth['redis']> {
    if (!this.redis) {
      return {
        healthy: false,
        latency: 0,
        errorRate: 0
      };
    }

    const startTime = Date.now();
    
    try {
      await this.redis.ping();
      const latency = Date.now() - startTime;
      this.totalRedisRequests++;

      const errorRate = this.totalRedisRequests > 0 ? 
        (this.redisErrorCount / this.totalRedisRequests) * 100 : 0;

      return {
        healthy: latency < 500 && errorRate < 5, // Healthy if latency < 500ms and error rate < 5%
        latency,
        errorRate
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      this.redisErrorCount++;
      this.totalRedisRequests++;

      const errorRate = (this.redisErrorCount / this.totalRedisRequests) * 100;

      return {
        healthy: false,
        latency,
        errorRate
      };
    }
  }

  /**
   * Optimize database connections
   */
  async optimizeConnections(): Promise<void> {
    try {
      const stats = await this.getPoolStats();
      
      // Check if we're approaching connection limits
      const connectionUtilization = stats.database.total / stats.database.maxConnections;
      
      if (connectionUtilization > 0.8) {
        logger.warn(`⚠️ High database connection utilization: ${(connectionUtilization * 100).toFixed(1)}%`);
        
        // Close idle connections
        await this.prisma.$executeRaw`
          SELECT pg_terminate_backend(pid) 
          FROM pg_stat_activity 
          WHERE state = 'idle' 
          AND state_change < NOW() - INTERVAL '10 minutes'
          AND datname = current_database()
          AND pid != pg_backend_pid()
        `;
        
        logger.info('🧹 Cleaned up idle database connections');
      }

      // Optimize Redis if available
      if (this.redis && stats.redis.status === 'ready') {
        const clientUtilization = stats.redis.connectedClients / stats.redis.maxClients;
        
        if (clientUtilization > 0.8) {
          logger.warn(`⚠️ High Redis client utilization: ${(clientUtilization * 100).toFixed(1)}%`);
          
          // Could implement Redis connection cleanup here if needed
        }
      }

    } catch (error) {
      logger.error('Error optimizing connections:', error);
    }
  }

  /**
   * Get connection pool health summary
   */
  async getHealthSummary(): Promise<{
    overall: 'healthy' | 'warning' | 'critical';
    database: boolean;
    redis: boolean;
    details: ConnectionHealth;
  }> {
    const health = await this.performHealthCheck();
    
    let overall: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (!health.database.healthy && !health.redis.healthy) {
      overall = 'critical';
    } else if (!health.database.healthy || !health.redis.healthy) {
      overall = 'warning';
    }

    return {
      overall,
      database: health.database.healthy,
      redis: health.redis.healthy,
      details: health
    };
  }

  /**
   * Reset error counters
   */
  resetErrorCounters(): void {
    this.databaseErrorCount = 0;
    this.redisErrorCount = 0;
    this.totalDbRequests = 0;
    this.totalRedisRequests = 0;
    
    logger.info('🔄 Connection pool error counters reset');
  }

  /**
   * Get detailed metrics for monitoring
   */
  async getDetailedMetrics(): Promise<{
    database: {
      connectionStats: PoolStats['database'];
      health: ConnectionHealth['database'];
      queries: {
        slow: number;
        active: number;
        waiting: number;
      };
    };
    redis: {
      connectionStats: PoolStats['redis'];
      health: ConnectionHealth['redis'];
      memory: {
        used: string;
        peak: string;
        fragmentation: number;
      };
    };
  }> {
    const [stats, health] = await Promise.all([
      this.getPoolStats(),
      this.performHealthCheck()
    ]);

    // Get additional database metrics
    const dbMetrics = await this.getDetailedDatabaseMetrics();
    const redisMetrics = await this.getDetailedRedisMetrics();

    return {
      database: {
        connectionStats: stats.database,
        health: health.database,
        queries: dbMetrics
      },
      redis: {
        connectionStats: stats.redis,
        health: health.redis,
        memory: redisMetrics
      }
    };
  }

  /**
   * Get detailed database metrics
   */
  private async getDetailedDatabaseMetrics(): Promise<{
    slow: number;
    active: number;
    waiting: number;
  }> {
    try {
      const queryStats = await this.prisma.$queryRaw<Array<{
        state: string;
        count: number;
      }>>`
        SELECT 
          CASE 
            WHEN state = 'active' AND NOW() - query_start > INTERVAL '5 seconds' THEN 'slow'
            WHEN state = 'active' THEN 'active'
            WHEN wait_event IS NOT NULL THEN 'waiting'
            ELSE 'other'
          END as state,
          COUNT(*) as count
        FROM pg_stat_activity 
        WHERE datname = current_database()
        GROUP BY 1
      `;

      let slow = 0, active = 0, waiting = 0;

      queryStats.forEach(({ state, count }) => {
        switch (state) {
          case 'slow': slow = Number(count); break;
          case 'active': active = Number(count); break;
          case 'waiting': waiting = Number(count); break;
        }
      });

      return { slow, active, waiting };

    } catch (error) {
      logger.error('Error getting detailed database metrics:', error);
      return { slow: 0, active: 0, waiting: 0 };
    }
  }

  /**
   * Get detailed Redis metrics
   */
  private async getDetailedRedisMetrics(): Promise<{
    used: string;
    peak: string;
    fragmentation: number;
  }> {
    if (!this.redis) {
      return { used: '0B', peak: '0B', fragmentation: 0 };
    }

    try {
      const info = await this.redis.info('memory');
      const lines = info.split('\r\n');
      
      let used = '0B', peak = '0B', fragmentation = 0;

      lines.forEach(line => {
        if (line.startsWith('used_memory_human:')) {
          used = line.split(':')[1];
        } else if (line.startsWith('used_memory_peak_human:')) {
          peak = line.split(':')[1];
        } else if (line.startsWith('mem_fragmentation_ratio:')) {
          fragmentation = parseFloat(line.split(':')[1]);
        }
      });

      return { used, peak, fragmentation };

    } catch (error) {
      logger.error('Error getting detailed Redis metrics:', error);
      return { used: '0B', peak: '0B', fragmentation: 0 };
    }
  }
}

export default ConnectionPoolService;