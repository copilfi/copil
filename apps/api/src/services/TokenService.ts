import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import redis from '@/config/redis';
import env from '@/config/env';
import { logger } from '@/utils/logger';

export interface TokenPayload {
  userId: string;
  address: string;
  email?: string;
  jti: string; // JWT ID for blacklisting
  iat?: number;
  exp?: number;
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

  /**
   * Generate JWT access token with unique JTI
   */
  static generateAccessToken(payload: Omit<TokenPayload, 'jti' | 'iat' | 'exp'>): string {
    const jti = uuidv4(); // Unique identifier for this token
    const tokenPayload: TokenPayload = {
      ...payload,
      jti
    };

    const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: 'copil-defi-api',
      audience: 'copil-defi-frontend'
    });

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
    await redis.client.setex(key, expireSeconds, JSON.stringify(refreshTokenData));

    // Store token family for user
    const familyKey = `${this.TOKEN_FAMILY_PREFIX}${userId}`;
    await redis.client.setex(familyKey, expireSeconds, tokenFamily);

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
    newAccessToken: string;
    newRefreshToken: string;
    userId: string;
  } | null> {
    try {
      const key = `${this.REFRESH_TOKEN_PREFIX}${refreshToken}`;
      const stored = await redis.client.get(key);
      
      if (!stored) {
        logger.warn('Refresh token not found or expired');
        return null;
      }

      const refreshData: RefreshTokenData = JSON.parse(stored);

      // Check if token family is still valid (not compromised)
      const familyKey = `${this.TOKEN_FAMILY_PREFIX}${refreshData.userId}`;
      const currentFamily = await redis.client.get(familyKey);

      if (currentFamily !== refreshData.tokenFamily) {
        logger.error(`Token family mismatch detected for user ${refreshData.userId} - possible token theft`);
        // Invalidate all tokens for this user
        await this.invalidateAllUserTokens(refreshData.userId);
        return null;
      }

      // Generate new token pair
      const newAccessToken = this.generateAccessToken({
        userId: refreshData.userId,
        address: '', // Will be filled by user lookup
        email: undefined
      });

      const newRefreshToken = await this.generateRefreshToken(refreshData.userId);

      // Invalidate old refresh token
      await redis.client.del(key);

      logger.info(`Token rotation completed for user ${refreshData.userId}`);
      return {
        newAccessToken,
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
        }), 'EX', expireSeconds);

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
      const keys = await redis.keys(pattern);
      
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
      const keys = await redis.keys(pattern);
      let cleaned = 0;

      for (const key of keys) {
        const ttl = await redis.ttl(key);
        if (ttl <= 0) { // Expired or no expiration
          await redis.del(key);
          cleaned++;
        }
      }

      // Also cleanup expired refresh tokens
      const refreshPattern = `${this.REFRESH_TOKEN_PREFIX}*`;
      const refreshKeys = await redis.keys(refreshPattern);
      
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
      const blacklistedKeys = await redis.keys(`${this.TOKEN_BLACKLIST_PREFIX}*`);
      const refreshKeys = await redis.keys(`${this.REFRESH_TOKEN_PREFIX}*`);

      return {
        blacklistedTokens: blacklistedKeys.length,
        activeRefreshTokens: refreshKeys.length
      };
    } catch (error) {
      logger.error('Failed to get token stats:', error);
      return { blacklistedTokens: 0, activeRefreshTokens: 0 };
    }
  }
}

export default TokenService;