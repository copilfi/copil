import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import env from './env';

class RedisClient {
  private static instance: RedisClient;
  public client: Redis;

  private constructor() {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    this.setupEventHandlers();
  }

  static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('🔴 Redis connecting...');
    });

    this.client.on('ready', () => {
      logger.info('🔴 Redis connected successfully');
    });

    this.client.on('error', (error) => {
      logger.error('❌ Redis connection error:', error);
    });

    this.client.on('close', () => {
      logger.warn('🔴 Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('🔴 Redis reconnecting...');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('❌ Redis connection failed:', error);
      // Don't exit process, let app continue without Redis
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      logger.info('🔴 Redis disconnected');
    } catch (error) {
      logger.error('❌ Redis disconnection failed:', error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('❌ Redis health check failed:', error);
      return false;
    }
  }

  // Cache utilities
  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error(`❌ Redis SET failed for key ${key}:`, error);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`❌ Redis GET failed for key ${key}:`, error);
      return null;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error(`❌ Redis DEL failed for key ${key}:`, error);
    }
  }

  async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.set(key, serialized, ttl);
    } catch (error) {
      logger.error(`❌ Redis SET JSON failed for key ${key}:`, error);
    }
  }

  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const value = await this.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`❌ Redis GET JSON failed for key ${key}:`, error);
      return null;
    }
  }
}

export const redis = RedisClient.getInstance();
export default redis;