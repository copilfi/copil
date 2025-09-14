import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import env from '@/config/env';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
  serialize?: boolean; // Whether to JSON serialize/deserialize
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

export class CacheService {
  private redis: Redis | null = null;
  private fallbackCache: Map<string, { value: any; expires: number }> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0
  };

  constructor() {
    this.initializeRedis();
    
    // Clean up fallback cache periodically
    setInterval(() => {
      this.cleanupFallbackCache();
    }, 60000); // Every minute
  }

  /**
   * Initialize Redis connection with fallback handling
   */
  private async initializeRedis(): Promise<void> {
    try {
      if (!env.REDIS_URL) {
        logger.warn('Redis URL not configured, using in-memory fallback cache');
        return;
      }

      this.redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4, // Force IPv4
        connectTimeout: 10000,
        commandTimeout: 5000
      });

      this.redis.on('connect', () => {
        logger.info('✅ Redis connected successfully');
      });

      this.redis.on('error', (error) => {
        logger.error('❌ Redis connection error:', error);
        // Don't throw, just log and use fallback
      });

      this.redis.on('reconnecting', (time: number) => {
        logger.warn(`🔄 Redis reconnecting in ${time}ms`);
      });

      this.redis.on('close', () => {
        logger.warn('⚠️ Redis connection closed, using fallback cache');
      });

      // Test connection
      await this.redis.ping();
      
    } catch (error) {
      logger.error('Failed to initialize Redis:', error);
      this.redis = null; // Ensure fallback is used
    }
  }

  /**
   * Get value from cache
   */
  async get<T = any>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const fullKey = this.buildKey(key, options.prefix);
    
    try {
      let value: string | null = null;
      
      if (this.redis?.status === 'ready') {
        value = await this.redis.get(fullKey);
      } else {
        // Fallback cache
        const cached = this.fallbackCache.get(fullKey);
        if (cached && cached.expires > Date.now()) {
          value = cached.value;
        } else if (cached) {
          this.fallbackCache.delete(fullKey);
        }
      }

      if (value !== null) {
        this.stats.hits++;
        this.updateHitRate();
        
        if (options.serialize !== false) {
          try {
            return JSON.parse(value) as T;
          } catch {
            return value as T;
          }
        }
        return value as T;
      }

      this.stats.misses++;
      this.updateHitRate();
      return null;

    } catch (error) {
      logger.error(`Cache get error for key ${fullKey}:`, error);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T = any>(
    key: string, 
    value: T, 
    options: CacheOptions = {}
  ): Promise<boolean> {
    const fullKey = this.buildKey(key, options.prefix);
    const ttl = options.ttl || 3600; // Default 1 hour
    
    try {
      let serializedValue: string;
      
      if (options.serialize !== false) {
        serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      } else {
        serializedValue = value as string;
      }

      if (this.redis?.status === 'ready') {
        await this.redis.setex(fullKey, ttl, serializedValue);
      } else {
        // Fallback cache
        this.fallbackCache.set(fullKey, {
          value: serializedValue,
          expires: Date.now() + (ttl * 1000)
        });
      }

      this.stats.sets++;
      return true;

    } catch (error) {
      logger.error(`Cache set error for key ${fullKey}:`, error);
      return false;
    }
  }

  /**
   * Delete key from cache
   */
  async delete(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.prefix);
    
    try {
      if (this.redis?.status === 'ready') {
        await this.redis.del(fullKey);
      } else {
        this.fallbackCache.delete(fullKey);
      }

      this.stats.deletes++;
      return true;

    } catch (error) {
      logger.error(`Cache delete error for key ${fullKey}:`, error);
      return false;
    }
  }

  /**
   * Get multiple keys at once
   */
  async mget<T = any>(keys: string[], options: CacheOptions = {}): Promise<(T | null)[]> {
    const fullKeys = keys.map(key => this.buildKey(key, options.prefix));
    
    try {
      let values: (string | null)[];
      
      if (this.redis?.status === 'ready') {
        values = await this.redis.mget(...fullKeys);
      } else {
        values = fullKeys.map(key => {
          const cached = this.fallbackCache.get(key);
          if (cached && cached.expires > Date.now()) {
            return cached.value;
          }
          return null;
        });
      }

      return values.map(value => {
        if (value !== null) {
          this.stats.hits++;
          if (options.serialize !== false) {
            try {
              return JSON.parse(value) as T;
            } catch {
              return value as T;
            }
          }
          return value as T;
        }
        this.stats.misses++;
        return null;
      });

    } catch (error) {
      logger.error(`Cache mget error:`, error);
      return keys.map(() => null);
    } finally {
      this.updateHitRate();
    }
  }

  /**
   * Set multiple keys at once
   */
  async mset<T = any>(
    keyValues: Record<string, T>, 
    options: CacheOptions = {}
  ): Promise<boolean> {
    const ttl = options.ttl || 3600;
    
    try {
      const pipeline = this.redis?.pipeline();
      
      for (const [key, value] of Object.entries(keyValues)) {
        const fullKey = this.buildKey(key, options.prefix);
        let serializedValue: string;
        
        if (options.serialize !== false) {
          serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
        } else {
          serializedValue = value as string;
        }

        if (pipeline) {
          pipeline.setex(fullKey, ttl, serializedValue);
        } else {
          // Fallback cache
          this.fallbackCache.set(fullKey, {
            value: serializedValue,
            expires: Date.now() + (ttl * 1000)
          });
        }
      }

      if (pipeline) {
        await pipeline.exec();
      }

      this.stats.sets += Object.keys(keyValues).length;
      return true;

    } catch (error) {
      logger.error('Cache mset error:', error);
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.prefix);
    
    try {
      if (this.redis?.status === 'ready') {
        return (await this.redis.exists(fullKey)) === 1;
      } else {
        const cached = this.fallbackCache.get(fullKey);
        return cached ? cached.expires > Date.now() : false;
      }
    } catch (error) {
      logger.error(`Cache exists error for key ${fullKey}:`, error);
      return false;
    }
  }

  /**
   * Set expiration for existing key
   */
  async expire(key: string, ttl: number, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.prefix);
    
    try {
      if (this.redis?.status === 'ready') {
        return (await this.redis.expire(fullKey, ttl)) === 1;
      } else {
        const cached = this.fallbackCache.get(fullKey);
        if (cached) {
          cached.expires = Date.now() + (ttl * 1000);
          return true;
        }
        return false;
      }
    } catch (error) {
      logger.error(`Cache expire error for key ${fullKey}:`, error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0
    };
  }

  /**
   * Clear all cache
   */
  async clear(prefix?: string): Promise<boolean> {
    try {
      if (this.redis?.status === 'ready') {
        if (prefix) {
          const pattern = this.buildKey('*', prefix);
          const keys = await this.redis.keys(pattern);
          if (keys.length > 0) {
            await this.redis.del(...keys);
          }
        } else {
          await this.redis.flushdb();
        }
      } else {
        if (prefix) {
          const prefixKey = `${prefix}:`;
          for (const key of this.fallbackCache.keys()) {
            if (key.startsWith(prefixKey)) {
              this.fallbackCache.delete(key);
            }
          }
        } else {
          this.fallbackCache.clear();
        }
      }
      return true;
    } catch (error) {
      logger.error('Cache clear error:', error);
      return false;
    }
  }

  /**
   * Get Redis connection status
   */
  getConnectionStatus(): {
    redis: boolean;
    fallback: boolean;
    redisStatus: string | null;
    fallbackSize: number;
  } {
    return {
      redis: this.redis?.status === 'ready',
      fallback: !this.redis || this.redis.status !== 'ready',
      redisStatus: this.redis?.status || null,
      fallbackSize: this.fallbackCache.size
    };
  }

  /**
   * Build cache key with prefix
   */
  private buildKey(key: string, prefix?: string): string {
    const defaultPrefix = 'copil';
    const finalPrefix = prefix || defaultPrefix;
    return `${finalPrefix}:${key}`;
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * Clean up expired items from fallback cache
   */
  private cleanupFallbackCache(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, cached] of this.fallbackCache.entries()) {
      if (cached.expires <= now) {
        this.fallbackCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired items from fallback cache`);
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
    this.fallbackCache.clear();
  }
}

// Cache decorators for common use cases
export const cache = (options: CacheOptions = {}) => {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const cacheService = new CacheService();

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${target.constructor.name}:${propertyKey}:${JSON.stringify(args)}`;
      
      // Try to get from cache first
      const cached = await cacheService.get(cacheKey, options);
      if (cached !== null) {
        return cached;
      }

      // Call original method
      const result = await originalMethod.apply(this, args);
      
      // Cache the result
      await cacheService.set(cacheKey, result, options);
      
      return result;
    };

    return descriptor;
  };
};

export default CacheService;