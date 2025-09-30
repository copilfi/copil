import jwt, { JwtPayload, Secret, SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import redis from '@/config/redis';
import env from '@/config/env';
import { logger } from '@/utils/logger';

export interface TokenPayload extends JwtPayload {
  userId: string;
  address: string;
  email?: string;
  jti: string; // JWT ID for blacklisting
}

export interface RefreshTokenData {
  userId: string;
  tokenFamily: string;
  issuedAt: number;
  expiresAt: number;
}

export class TokenService {
  private static readonly TOKEN_BLACKLIST_PREFIX = 'blacklisted_token:';
  private static readonly REFRESH_TOKEN_PREFIX = 'refresh_token:';
  private static readonly TOKEN_FAMILY_PREFIX = 'token_family:';
  private static readonly MAX_TOKEN_FAMILIES = 5;

  /**
   * Generate JWT access token with unique JTI
   */
  static generateAccessToken(payload: Omit<TokenPayload, 'jti' | 'iat' | 'exp'>): string {
    const jti = uuidv4(); // Unique identifier for this token
    const tokenPayload = {
      ...payload,
      jti
    } as TokenPayload;

    const token = jwt.sign(
      tokenPayload as JwtPayload,
      env.JWT_SECRET as Secret,
      {
        expiresIn: env.JWT_EXPIRES_IN,
        issuer: 'copil-defi-api',
        audience: 'copil-defi-frontend'
      } as SignOptions
    );

    logger.info(`Access token generated for user ${payload.userId} with JTI: ${jti}`);
    return token;
  }

  /**
   * Generate refresh token with token family rotation
   */
  static async generateRefreshToken(userId: string): Promise<string> {
    const tokenFamily = uuidv4();
    const refreshToken = uuidv4();
    const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

    const refreshTokenData: RefreshTokenData = {
      userId,
      tokenFamily,
      issuedAt: Date.now(),
      expiresAt
    };

    // Store refresh token data
    const key = `${this.REFRESH_TOKEN_PREFIX}${refreshToken}`;
    const expireSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
    await redis.set(key, JSON.stringify(refreshTokenData), expireSeconds);

    await this.registerTokenFamily(userId, tokenFamily, expiresAt);

    logger.info(`Refresh token generated for user ${userId} with family: ${tokenFamily}`);
    return refreshToken;
  }

  /**
   * Verify and decode JWT token
   */
  static async verifyAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        logger.warn('Attempted to use blacklisted token');
        return null;
      }

      // Verify JWT signature and expiration
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        issuer: 'copil-defi-api',
        audience: 'copil-defi-frontend'
      }) as TokenPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.info('Token expired');
        // Automatically blacklist expired tokens to prevent replay
        await this.blacklistToken(token, 'expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        logger.warn('Invalid token signature');
      }
      return null;
    }
  }

  /**
   * Verify refresh token and rotate if valid
   */
  static async verifyAndRotateRefreshToken(refreshToken: string): Promise<{
    newRefreshToken: string;
    userId: string;
  } | null> {
    try {
      const key = `${this.REFRESH_TOKEN_PREFIX}${refreshToken}`;
      const stored = await redis.get(key);
      
      if (!stored) {
        logger.warn('Refresh token not found or expired');
        return null;
      }

      const refreshData: RefreshTokenData = JSON.parse(stored);

      if (Date.now() > refreshData.expiresAt) {
        logger.warn(`Refresh token expired for user ${refreshData.userId}`);
        await redis.del(key);
        await this.removeTokenFamily(refreshData.userId, refreshData.tokenFamily);
        return null;
      }

      // Check if token family is still valid (not compromised)
      const isFamilyAllowed = await this.isTokenFamilyAllowed(
        refreshData.userId,
        refreshData.tokenFamily,
        refreshData.expiresAt
      );

      if (!isFamilyAllowed) {
        logger.error(`Token family mismatch detected for user ${refreshData.userId} - possible token theft`);
        // Invalidate all tokens for this user
        await this.invalidateAllUserTokens(refreshData.userId);
        return null;
      }

      // Generate new token pair
      const newRefreshToken = await this.generateRefreshToken(refreshData.userId);

      // Invalidate old refresh token
      await redis.del(key);
      await this.removeTokenFamily(refreshData.userId, refreshData.tokenFamily);

      logger.info(`Token rotation completed for user ${refreshData.userId}`);
      return {
        newRefreshToken,
        userId: refreshData.userId
      };

    } catch (error) {
      logger.error('Refresh token verification failed:', error);
      return null;
    }
  }

  /**
   * Blacklist a token (logout, compromise, etc.)
   */
  static async blacklistToken(token: string, reason: string = 'manual'): Promise<void> {
    try {
      // Decode token to get expiration
      const decoded = jwt.decode(token) as TokenPayload;
      if (!decoded || !decoded.exp) {
        logger.warn('Cannot blacklist malformed token');
        return;
      }

      const jti = decoded.jti;
      const expireTime = decoded.exp * 1000; // Convert to milliseconds
      const remainingTime = Math.max(0, expireTime - Date.now());

      if (remainingTime > 0) {
        const key = `${this.TOKEN_BLACKLIST_PREFIX}${jti}`;
        const expireSeconds = Math.ceil(remainingTime / 1000);
        
        await redis.set(key, JSON.stringify({
          reason,
          blacklistedAt: Date.now(),
          userId: decoded.userId
        }), expireSeconds);

        logger.info(`Token blacklisted for user ${decoded.userId} (JTI: ${jti}, reason: ${reason})`);
      }
    } catch (error) {
      logger.error('Failed to blacklist token:', error);
    }
  }

  /**
   * Check if token is blacklisted
   */
  static async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const decoded = jwt.decode(token) as TokenPayload;
      if (!decoded || !decoded.jti) return false;

      const key = `${this.TOKEN_BLACKLIST_PREFIX}${decoded.jti}`;
      const exists = await redis.get(key);
      return exists !== null;
    } catch (error) {
      logger.error('Error checking token blacklist:', error);
      return false;
    }
  }

  /**
   * Invalidate all tokens for a user (compromise detected)
   */
  static async invalidateAllUserTokens(userId: string): Promise<void> {
    try {
      // Remove token family to invalidate all refresh tokens
      const familyKey = `${this.TOKEN_FAMILY_PREFIX}${userId}`;
      await redis.del(familyKey);

      // Find and blacklist all active access tokens for this user
      const pattern = `${this.TOKEN_BLACKLIST_PREFIX}*`;
      const keys = await redis.client.keys(pattern);
      
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const blacklistData = JSON.parse(data);
          if (blacklistData.userId === userId) {
            // Token already blacklisted, skip
            continue;
          }
        }
      }

      logger.info(`All tokens invalidated for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to invalidate all tokens for user ${userId}:`, error);
    }
  }

  /**
   * Logout user by blacklisting their current token
   */
  static async logout(token: string): Promise<void> {
    await this.blacklistToken(token, 'logout');
  }

  /**
   * Clean up expired blacklisted tokens (called by cron job)
   */
  static async cleanupExpiredTokens(): Promise<void> {
    try {
      const pattern = `${this.TOKEN_BLACKLIST_PREFIX}*`;
      const keys = await redis.client.keys(pattern);
      let cleaned = 0;

      for (const key of keys) {
        const ttl = await redis.client.ttl(key);
        if (ttl <= 0) { // Expired or no expiration
          await redis.del(key);
          cleaned++;
        }
      }

      // Also cleanup expired refresh tokens
      const refreshPattern = `${this.REFRESH_TOKEN_PREFIX}*`;
      const refreshKeys = await redis.client.keys(refreshPattern);
      
      for (const key of refreshKeys) {
        const data = await redis.get(key);
        if (data) {
          const refreshData: RefreshTokenData = JSON.parse(data);
          if (Date.now() > refreshData.expiresAt) {
            await redis.del(key);
            cleaned++;
          }
        }
      }

      cleaned += await this.cleanupExpiredTokenFamilies();

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired tokens`);
      }
    } catch (error) {
      logger.error('Failed to cleanup expired tokens:', error);
    }
  }

  /**
   * Get token statistics (for monitoring)
   */
  static async getTokenStats(): Promise<{
    blacklistedTokens: number;
    activeRefreshTokens: number;
  }> {
    try {
      const blacklistedKeys = await redis.client.keys(`${this.TOKEN_BLACKLIST_PREFIX}*`);
      const refreshKeys = await redis.client.keys(`${this.REFRESH_TOKEN_PREFIX}*`);

      return {
        blacklistedTokens: blacklistedKeys.length,
        activeRefreshTokens: refreshKeys.length
      };
    } catch (error) {
      logger.error('Failed to get token stats:', error);
      return { blacklistedTokens: 0, activeRefreshTokens: 0 };
    }
  }

  private static async registerTokenFamily(userId: string, tokenFamily: string, expiresAt: number): Promise<void> {
    const key = `${this.TOKEN_FAMILY_PREFIX}${userId}`;
    const score = expiresAt;
    try {
      await redis.client.zadd(key, score, tokenFamily);
      await redis.client.zremrangebyscore(key, '-inf', Date.now());

      const count = await redis.client.zcard(key);
      const overflow = count - this.MAX_TOKEN_FAMILIES;
      if (overflow > 0) {
        await redis.client.zremrangebyrank(key, 0, overflow - 1);
      }

      const latest = await redis.client.zrange(key, -1, -1, 'WITHSCORES');
      if (Array.isArray(latest) && latest.length === 2) {
        const maxExpiry = Number(latest[1]);
        if (Number.isFinite(maxExpiry)) {
          await redis.client.expireat(key, Math.ceil(maxExpiry / 1000));
        }
      }
    } catch (error: any) {
      if (typeof error?.message === 'string' && error.message.includes('WRONGTYPE')) {
        await redis.del(key);
        await this.registerTokenFamily(userId, tokenFamily, expiresAt);
      } else {
        logger.error(`Failed to register token family for user ${userId}:`, error);
      }
    }
  }

  private static async isTokenFamilyAllowed(userId: string, tokenFamily: string, expiresAt?: number): Promise<boolean> {
    const key = `${this.TOKEN_FAMILY_PREFIX}${userId}`;

    try {
      const score = await redis.client.zscore(key, tokenFamily);
      if (score !== null && score !== undefined) {
        return Number(score) > Date.now();
      }
      return false;
    } catch (error: any) {
      if (typeof error?.message === 'string' && error.message.includes('WRONGTYPE')) {
        const legacyValue = await redis.get(key);
        if (legacyValue === tokenFamily) {
          if (expiresAt) {
            await redis.del(key);
            await this.registerTokenFamily(userId, tokenFamily, expiresAt);
          }
          return true;
        }
        return false;
      }

      logger.error(`Failed to verify token family for user ${userId}:`, error);
      return false;
    }
  }

  private static async removeTokenFamily(userId: string, tokenFamily: string): Promise<void> {
    const key = `${this.TOKEN_FAMILY_PREFIX}${userId}`;
    try {
      await redis.client.zrem(key, tokenFamily);
      const remaining = await redis.client.zcard(key);
      if (remaining === 0) {
        await redis.client.del(key);
      }
    } catch (error: any) {
      if (typeof error?.message === 'string' && error.message.includes('WRONGTYPE')) {
        await redis.del(key);
      } else {
        logger.error(`Failed to remove token family for user ${userId}:`, error);
      }
    }
  }

  private static async cleanupExpiredTokenFamilies(): Promise<number> {
    const pattern = `${this.TOKEN_FAMILY_PREFIX}*`;
    let cursor = '0';
    let cleaned = 0;

    try {
      do {
        const [nextCursor, keys] = await redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 50);
        cursor = nextCursor;

        for (const key of keys) {
          try {
            const removed = await redis.client.zremrangebyscore(key, '-inf', Date.now());
            cleaned += removed;

            const remaining = await redis.client.zcard(key);
            if (remaining === 0) {
              await redis.client.del(key);
            }
          } catch (error: any) {
            if (typeof error?.message === 'string' && error.message.includes('WRONGTYPE')) {
              await redis.client.del(key);
            } else {
              logger.error(`Failed to cleanup token family key ${key}:`, error);
            }
          }
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.error('Failed to iterate token family whitelist keys:', error);
    }

    return cleaned;
  }
}

export default TokenService;
