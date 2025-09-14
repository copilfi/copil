import rateLimit from 'express-rate-limit';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

// Custom store using Redis for rate limiting across multiple instances
class RedisStore {
  constructor(private prefix: string = 'rl:') {}

  async increment(key: string): Promise<{ totalCount: number; timeToExpire?: number }> {
    try {
      const redis = RedisService.getInstance();
      const fullKey = `${this.prefix}${key}`;
      
      const [current, ttl] = await Promise.all([
        redis.incr(fullKey),
        redis.ttl(fullKey)
      ]);

      // Set expiration if this is the first increment
      if (current === 1) {
        await redis.expire(fullKey, 900); // 15 minutes default
        return { totalCount: current, timeToExpire: 900 };
      }

      return { 
        totalCount: current, 
        timeToExpire: ttl > 0 ? ttl : undefined 
      };
    } catch (error) {
      logger.error('Redis rate limiter error:', error);
      // Fallback to allowing request if Redis fails
      return { totalCount: 1 };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const redis = RedisService.getInstance();
      const fullKey = `${this.prefix}${key}`;
      await redis.decr(fullKey);
    } catch (error) {
      logger.error('Redis rate limiter decrement error:', error);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      const redis = RedisService.getInstance();
      const fullKey = `${this.prefix}${key}`;
      await redis.del(fullKey);
    } catch (error) {
      logger.error('Redis rate limiter reset error:', error);
    }
  }
}

const redisStore = new RedisStore();

// General API rate limiter
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: {
    error: 'Too many requests from this IP',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 900, // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: {
    incr: (key: string, cb: (error?: Error, result?: { totalCount: number; timeToExpire?: number }) => void) => {
      redisStore.increment(key).then(result => cb(undefined, result)).catch(cb);
    },
    decrement: (key: string) => {
      redisStore.decrement(key);
    },
    resetKey: (key: string) => {
      redisStore.resetKey(key);
    }
  },
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise IP
    const user = (req as any).user;
    return user ? `user:${user.id}` : `ip:${req.ip}`;
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});

// Stricter rate limiter for AI endpoints
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: async (req) => {
    const user = (req as any).user;
    if (!user) return 10; // Anonymous users get very limited access
    
    // Get user subscription limits from database
    // This would need to be implemented based on user subscription
    // For now, return default limits
    return 100; // Default limit for authenticated users
  },
  message: {
    error: 'AI request limit exceeded',
    code: 'AI_RATE_LIMIT_EXCEEDED',
    retryAfter: 3600,
  },
  store: {
    incr: (key: string, cb: (error?: Error, result?: { totalCount: number; timeToExpire?: number }) => void) => {
      const aiStore = new RedisStore('ai_rl:');
      aiStore.increment(key).then(result => cb(undefined, result)).catch(cb);
    },
    decrement: (key: string) => {
      const aiStore = new RedisStore('ai_rl:');
      aiStore.decrement(key);
    },
    resetKey: (key: string) => {
      const aiStore = new RedisStore('ai_rl:');
      aiStore.resetKey(key);
    }
  },
  keyGenerator: (req) => {
    const user = (req as any).user;
    return user ? `user:${user.id}` : `ip:${req.ip}`;
  },
});

// Trading rate limiter - more permissive but still protective
export const tradingRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    error: 'Trading request limit exceeded',
    code: 'TRADING_RATE_LIMIT_EXCEEDED',
    retryAfter: 60,
  },
  store: {
    incr: (key: string, cb: (error?: Error, result?: { totalCount: number; timeToExpire?: number }) => void) => {
      const tradingStore = new RedisStore('trading_rl:');
      tradingStore.increment(key).then(result => cb(undefined, result)).catch(cb);
    },
    decrement: (key: string) => {
      const tradingStore = new RedisStore('trading_rl:');
      tradingStore.decrement(key);
    },
    resetKey: (key: string) => {
      const tradingStore = new RedisStore('trading_rl:');
      tradingStore.resetKey(key);
    }
  },
  keyGenerator: (req) => {
    const user = (req as any).user;
    return user ? `user:${user.id}` : `ip:${req.ip}`;
  },
});