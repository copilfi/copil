import Redis from 'ioredis';
import { logger } from '../utils/logger';

export class RedisService {
  private static instance: Redis | null = null;
  private static isConnected = false;

  static async connect(): Promise<void> {
    if (this.instance && this.isConnected) {
      return;
    }

    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      
      this.instance = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        connectTimeout: 10000,
        commandTimeout: 5000,
        lazyConnect: true,
      });

      // Event listeners
      this.instance.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connected successfully');
      });

      this.instance.on('error', (error) => {
        this.isConnected = false;
        logger.error('Redis connection error:', error);
      });

      this.instance.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });

      this.instance.on('reconnecting', (ms) => {
        logger.info(`Redis reconnecting in ${ms}ms`);
      });

      // Connect to Redis
      await this.instance.connect();
      
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  static getInstance(): Redis {
    if (!this.instance) {
      throw new Error('Redis not connected. Call connect() first.');
    }
    return this.instance;
  }

  static async disconnect(): Promise<void> {
    if (this.instance) {
      await this.instance.disconnect();
      this.instance = null;
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  static isRedisConnected(): boolean {
    return this.isConnected && this.instance !== null;
  }

  // Cache utilities
  static async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const redis = this.getInstance();
      const serializedValue = JSON.stringify(value);
      
      if (ttlSeconds) {
        await redis.setex(key, ttlSeconds, serializedValue);
      } else {
        await redis.set(key, serializedValue);
      }
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  }

  static async get<T>(key: string): Promise<T | null> {
    try {
      const redis = this.getInstance();
      const value = await redis.get(key);
      
      if (value === null) {
        return null;
      }
      
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      throw error;
    }
  }

  static async del(key: string): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.del(key);
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      throw error;
    }
  }

  static async exists(key: string): Promise<boolean> {
    try {
      const redis = this.getInstance();
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      throw error;
    }
  }

  static async expire(key: string, seconds: number): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.expire(key, seconds);
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      throw error;
    }
  }

  // Hash operations
  static async hset(key: string, field: string, value: any): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.hset(key, field, JSON.stringify(value));
    } catch (error) {
      logger.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  }

  static async hget<T>(key: string, field: string): Promise<T | null> {
    try {
      const redis = this.getInstance();
      const value = await redis.hget(key, field);
      
      if (value === null) {
        return null;
      }
      
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      throw error;
    }
  }

  static async hdel(key: string, field: string): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.hdel(key, field);
    } catch (error) {
      logger.error(`Redis HDEL error for key ${key}, field ${field}:`, error);
      throw error;
    }
  }

  // List operations
  static async lpush(key: string, value: any): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.lpush(key, JSON.stringify(value));
    } catch (error) {
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      throw error;
    }
  }

  static async rpop<T>(key: string): Promise<T | null> {
    try {
      const redis = this.getInstance();
      const value = await redis.rpop(key);
      
      if (value === null) {
        return null;
      }
      
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`Redis RPOP error for key ${key}:`, error);
      throw error;
    }
  }

  // Pub/Sub operations
  static async publish(channel: string, message: any): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.publish(channel, JSON.stringify(message));
    } catch (error) {
      logger.error(`Redis PUBLISH error for channel ${channel}:`, error);
      throw error;
    }
  }

  // Pattern-based key operations
  static async keys(pattern: string): Promise<string[]> {
    try {
      const redis = this.getInstance();
      return await redis.keys(pattern);
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
      throw error;
    }
  }
}