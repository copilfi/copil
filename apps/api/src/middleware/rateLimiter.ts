import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import redis from '@/config/redis';
import { logger } from '@/utils/logger';
import env from '@/config/env';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export class AdvancedRateLimiter {
  private static readonly RATE_LIMIT_PREFIX = 'rate_limit:';
  private static readonly BLOCKED_IP_PREFIX = 'blocked_ip:';
  private static readonly SUSPICIOUS_IP_PREFIX = 'suspicious_ip:';

  /**
   * Create rate limiter with Redis store
   */
  static createRateLimiter(options: RateLimitOptions) {
    return rateLimit({
      windowMs: options.windowMs,
      max: options.maxRequests,
      message: {
        success: false,
        error: options.message,
        retryAfter: Math.ceil(options.windowMs / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: options.skipSuccessfulRequests || false,
      skipFailedRequests: options.skipFailedRequests || false,
      
      // Custom key generator (IP + endpoint)
      keyGenerator: (req: Request) => {
        const clientIp = this.getClientIP(req);
        const endpoint = req.route?.path || req.path;
        return `${clientIp}:${endpoint}`;
      },

      // Custom skip function for whitelisted IPs
      skip: async (req: Request) => {
        const clientIp = this.getClientIP(req);
        return await this.isWhitelistedIP(clientIp);
      },

      // Custom store using Redis
      store: {
        incr: async (key: string) => {
          const fullKey = `${this.RATE_LIMIT_PREFIX}${key}`;
          const current = await redis.client.incr(fullKey);
          
          if (current === 1) {
            // Set expiration only on first request
            await redis.client.expire(fullKey, Math.ceil(options.windowMs / 1000));
          }
          
          return {
            totalHits: current,
            resetTime: new Date(Date.now() + options.windowMs)
          };
        },

        decrement: async (key: string) => {
          const fullKey = `${this.RATE_LIMIT_PREFIX}${key}`;
          await redis.client.decr(fullKey);
        },

        resetKey: async (key: string) => {
          const fullKey = `${this.RATE_LIMIT_PREFIX}${key}`;
          await redis.client.del(fullKey);
        }
      },

      // Enhanced logging and suspicious activity detection
      handler: async (req: Request, res: Response) => {
        const clientIp = this.getClientIP(req);
        const endpoint = req.route?.path || req.path;

        logger.warn(`Rate limit exceeded for IP ${clientIp} on ${endpoint}`, {
          ip: clientIp,
          endpoint,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString()
        });

        // Send rate limit response
        res.status(429).json({
          success: false,
          error: options.message,
          retryAfter: Math.ceil(options.windowMs / 1000)
        });

        // Track suspicious activity
        await this.trackSuspiciousActivity(clientIp, 'rate_limit_exceeded');
      }
    });
  }

  /**
   * Get client IP address (handles proxies and load balancers)
   */
  private static getClientIP(req: Request): string {
    const forwarded = req.get('X-Forwarded-For');
    const realIP = req.get('X-Real-IP');
    const cloudflareIP = req.get('CF-Connecting-IP');
    
    return (
      cloudflareIP ||
      realIP ||
      (forwarded ? forwarded.split(',')[0].trim() : '') ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Check if IP is whitelisted (for trusted services)
   */
  private static async isWhitelistedIP(ip: string): Promise<boolean> {
    const whitelistedIPs = [
      '127.0.0.1',
      '::1',
      'localhost'
      // Add your trusted IPs here
    ];

    return whitelistedIPs.includes(ip);
  }

  /**
   * Track suspicious activity for potential blocking
   */
  private static async trackSuspiciousActivity(ip: string, activity: string): Promise<void> {
    try {
      const key = `${this.SUSPICIOUS_IP_PREFIX}${ip}`;
      const current = await redis.client.incr(key);
      
      if (current === 1) {
        // Set 1 hour expiration
        await redis.client.expire(key, 3600);
      }

      // If too many suspicious activities, block IP temporarily
      if (current >= 5) {
        await this.blockIP(ip, 'automatic_block', 1800); // 30 minutes
        logger.error(`IP ${ip} automatically blocked due to suspicious activity: ${activity}`);
      }
    } catch (error) {
      logger.error('Failed to track suspicious activity:', error);
    }
  }

  /**
   * Block IP address temporarily
   */
  static async blockIP(ip: string, reason: string, durationSeconds: number = 3600): Promise<void> {
    try {
      const key = `${this.BLOCKED_IP_PREFIX}${ip}`;
      await redis.client.setex(key, durationSeconds, JSON.stringify({
        reason,
        blockedAt: Date.now(),
        expiresAt: Date.now() + (durationSeconds * 1000)
      }));

      logger.warn(`IP ${ip} blocked for ${durationSeconds} seconds (reason: ${reason})`);
    } catch (error) {
      logger.error('Failed to block IP:', error);
    }
  }

  /**
   * Check if IP is currently blocked
   */
  static async isIPBlocked(ip: string): Promise<boolean> {
    try {
      const key = `${this.BLOCKED_IP_PREFIX}${ip}`;
      const exists = await redis.client.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Failed to check IP block status:', error);
      return false;
    }
  }

  /**
   * Middleware to check blocked IPs
   */
  static blockChecker() {
    return async (req: Request, res: Response, next: any) => {
      const clientIp = this.getClientIP(req);
      const isBlocked = await this.isIPBlocked(clientIp);
      
      if (isBlocked) {
        logger.warn(`Blocked IP ${clientIp} attempted access to ${req.path}`);
        return res.status(403).json({
          success: false,
          error: 'Access denied. Your IP has been temporarily blocked due to suspicious activity.',
          code: 'IP_BLOCKED'
        });
      }

      next();
    };
  }

  /**
   * Unblock IP address (admin function)
   */
  static async unblockIP(ip: string): Promise<void> {
    try {
      const blockKey = `${this.BLOCKED_IP_PREFIX}${ip}`;
      const suspiciousKey = `${this.SUSPICIOUS_IP_PREFIX}${ip}`;
      
      await redis.client.del(blockKey);
      await redis.client.del(suspiciousKey);
      
      logger.info(`IP ${ip} unblocked`);
    } catch (error) {
      logger.error('Failed to unblock IP:', error);
    }
  }

  /**
   * Get rate limit statistics
   */
  static async getStats(): Promise<{
    blockedIPs: number;
    suspiciousIPs: number;
    activeRateLimits: number;
  }> {
    try {
      const [blockedKeys, suspiciousKeys, rateLimitKeys] = await Promise.all([
        redis.client.keys(`${this.BLOCKED_IP_PREFIX}*`),
        redis.client.keys(`${this.SUSPICIOUS_IP_PREFIX}*`),
        redis.client.keys(`${this.RATE_LIMIT_PREFIX}*`)
      ]);

      return {
        blockedIPs: blockedKeys.length,
        suspiciousIPs: suspiciousKeys.length,
        activeRateLimits: rateLimitKeys.length
      };
    } catch (error) {
      logger.error('Failed to get rate limit stats:', error);
      return { blockedIPs: 0, suspiciousIPs: 0, activeRateLimits: 0 };
    }
  }
}

// Pre-configured rate limiters for different endpoints
export const authRateLimit = AdvancedRateLimiter.createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 5, // 5 attempts per 5 minutes
  message: 'Too many authentication attempts. Please try again in 5 minutes.',
  skipSuccessfulRequests: true
});

export const generalRateLimit = AdvancedRateLimiter.createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per 15 minutes
  message: 'Too many requests. Please try again later.'
});

export const tradingRateLimit = AdvancedRateLimiter.createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 10, // 10 trades per minute
  message: 'Trading rate limit exceeded. Please wait before placing another trade.',
  skipFailedRequests: true
});

export const portfolioRateLimit = AdvancedRateLimiter.createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 30, // 30 portfolio requests per minute
  message: 'Portfolio data rate limit exceeded. Please wait before refreshing.'
});

// Strict rate limit for password reset and sensitive operations
export const strictRateLimit = AdvancedRateLimiter.createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3, // Only 3 attempts per hour
  message: 'Too many sensitive operation attempts. Please try again in 1 hour.',
  skipSuccessfulRequests: false
});

// Lenient rate limit for token refresh (automatic operation)
export const refreshTokenRateLimit = AdvancedRateLimiter.createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 20, // 20 refresh attempts per minute (generous for automatic retries)
  message: 'Token refresh rate limit exceeded. Please wait a moment.',
  skipSuccessfulRequests: true, // Don't count successful refreshes against limit
  skipFailedRequests: false // Count failed attempts to prevent abuse
});

export default AdvancedRateLimiter;