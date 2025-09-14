import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import redis from '@/config/redis';
import { logger } from '@/utils/logger';

export interface NonceData {
  nonce: string;
  userAddress: string;
  timestamp: number;
  expiresAt: number;
}

export class AuthHelpers {
  private static readonly NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private static readonly NONCE_PREFIX = 'auth_nonce:';
  private static readonly USED_NONCE_PREFIX = 'used_nonce:';

  /**
   * Generate a secure nonce for signature challenge
   */
  static generateNonce(userAddress: string): NonceData {
    const nonce = uuidv4();
    const timestamp = Date.now();
    const expiresAt = timestamp + this.NONCE_EXPIRY;

    return {
      nonce,
      userAddress: userAddress.toLowerCase(),
      timestamp,
      expiresAt
    };
  }

  /**
   * Store nonce in Redis with expiration
   */
  static async storeNonce(nonceData: NonceData): Promise<void> {
    try {
      const key = `${this.NONCE_PREFIX}${nonceData.nonce}`;
      const expireSeconds = Math.ceil(this.NONCE_EXPIRY / 1000);
      
      await redis.client.setex(key, expireSeconds, JSON.stringify(nonceData));
      
      logger.info(`Nonce stored for user ${nonceData.userAddress}: ${nonceData.nonce}`);
    } catch (error) {
      logger.error('Failed to store nonce:', error);
      throw new Error('Failed to generate authentication challenge');
    }
  }

  /**
   * Validate nonce without consuming it (for preliminary checks)
   */
  static async validateNonce(nonce: string, userAddress: string): Promise<boolean> {
    try {
      const key = `${this.NONCE_PREFIX}${nonce}`;
      const usedKey = `${this.USED_NONCE_PREFIX}${nonce}`;
      
      // Check if nonce exists
      const storedData = await redis.client.get(key);
      if (!storedData) {
        logger.warn(`Nonce not found: ${nonce}`);
        return false;
      }

      // Check if nonce was already used
      const isUsed = await redis.client.exists(usedKey);
      if (isUsed) {
        logger.warn(`Nonce already used: ${nonce}`);
        return false;
      }

      // Parse and validate nonce data
      const nonceData: NonceData = JSON.parse(storedData);
      
      if (nonceData.userAddress !== userAddress.toLowerCase()) {
        logger.warn(`Nonce address mismatch: expected ${nonceData.userAddress}, got ${userAddress.toLowerCase()}`);
        return false;
      }

      if (Date.now() > nonceData.expiresAt) {
        logger.warn(`Nonce expired: ${nonce}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Failed to validate nonce:', error);
      return false;
    }
  }

  /**
   * Verify and consume nonce (one-time use)
   */
  static async verifyAndConsumeNonce(nonce: string, userAddress: string): Promise<boolean> {
    try {
      const key = `${this.NONCE_PREFIX}${nonce}`;
      const usedKey = `${this.USED_NONCE_PREFIX}${nonce}`;
      
      // Check if nonce exists
      const storedData = await redis.client.get(key);
      if (!storedData) {
        logger.warn(`Nonce not found: ${nonce}`);
        return false;
      }

      // Check if nonce was already used
      const isUsed = await redis.client.exists(usedKey);
      if (isUsed) {
        logger.warn(`Nonce already used: ${nonce}`);
        return false;
      }

      // Parse and validate nonce data
      const nonceData: NonceData = JSON.parse(storedData);
      
      if (nonceData.userAddress !== userAddress.toLowerCase()) {
        logger.warn(`Nonce address mismatch: expected ${nonceData.userAddress}, got ${userAddress.toLowerCase()}`);
        return false;
      }

      if (Date.now() > nonceData.expiresAt) {
        logger.warn(`Nonce expired: ${nonce}`);
        return false;
      }

      // Mark nonce as used
      const expireSeconds = Math.ceil((nonceData.expiresAt - Date.now()) / 1000);
      await redis.client.setex(usedKey, Math.max(expireSeconds, 60), '1');
      
      // Delete original nonce
      await redis.client.del(key);
      
      logger.info(`Nonce verified and consumed for user ${userAddress}: ${nonce}`);
      return true;
    } catch (error) {
      logger.error('Failed to verify nonce:', error);
      return false;
    }
  }

  /**
   * Create secure message for signing
   */
  static createSignatureMessage(userAddress: string, nonce: string, timestamp: number): string {
    return `Welcome to Copil DeFi Automation Platform!

Sign this message to authenticate your wallet.

Wallet: ${userAddress}
Nonce: ${nonce}
Timestamp: ${timestamp}

This signature expires in 5 minutes.`;
  }

  /**
   * Validate Ethereum signature without consuming nonce (for preliminary checks)
   */
  static async validateSignatureWithNonce(
    message: string,
    signature: string,
    expectedAddress: string,
    nonce: string
  ): Promise<boolean> {
    try {
      // Verify signature cryptographically
      const recoveredAddress = ethers.verifyMessage(message, signature);
      
      if (recoveredAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
        logger.warn(`Signature address mismatch: expected ${expectedAddress}, got ${recoveredAddress}`);
        return false;
      }

      // Validate nonce without consuming it
      const nonceValid = await this.validateNonce(nonce, expectedAddress);
      if (!nonceValid) {
        logger.warn(`Nonce validation failed for ${expectedAddress}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Signature validation failed:', error);
      return false;
    }
  }

  /**
   * Verify Ethereum signature with replay protection (consumes nonce)
   */
  static async verifySignatureWithNonce(
    message: string,
    signature: string,
    expectedAddress: string,
    nonce: string
  ): Promise<boolean> {
    try {
      // Verify signature cryptographically
      const recoveredAddress = ethers.verifyMessage(message, signature);
      
      if (recoveredAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
        logger.warn(`Signature address mismatch: expected ${expectedAddress}, got ${recoveredAddress}`);
        return false;
      }

      // Verify and consume nonce for replay protection
      const nonceValid = await this.verifyAndConsumeNonce(nonce, expectedAddress);
      if (!nonceValid) {
        logger.warn(`Nonce verification failed for ${expectedAddress}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Extract nonce from signature message
   */
  static extractNonceFromMessage(message: string): string | null {
    const nonceMatch = message.match(/Nonce: ([a-f0-9-]+)/);
    return nonceMatch ? nonceMatch[1] : null;
  }

  /**
   * Extract timestamp from signature message
   */
  static extractTimestampFromMessage(message: string): number | null {
    const timestampMatch = message.match(/Timestamp: (\d+)/);
    return timestampMatch ? parseInt(timestampMatch[1]) : null;
  }

  /**
   * Validate message format
   */
  static validateMessageFormat(message: string, userAddress: string): boolean {
    const expectedStart = 'Welcome to Copil DeFi Automation Platform!';
    const addressPattern = `Wallet: ${userAddress}`;
    const noncePattern = /Nonce: [a-f0-9-]+/;
    const timestampPattern = /Timestamp: \d+/;

    return message.includes(expectedStart) &&
           message.includes(addressPattern) &&
           noncePattern.test(message) &&
           timestampPattern.test(message);
  }

  /**
   * Clean up expired nonces (called by cron job)
   */
  static async cleanupExpiredNonces(): Promise<void> {
    try {
      const pattern = `${this.NONCE_PREFIX}*`;
      const keys = await redis.client.keys(pattern);
      let cleaned = 0;

      for (const key of keys) {
        const data = await redis.client.get(key);
        if (data) {
          const nonceData: NonceData = JSON.parse(data);
          if (Date.now() > nonceData.expiresAt) {
            await redis.client.del(key);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired nonces`);
      }
    } catch (error) {
      logger.error('Failed to cleanup expired nonces:', error);
    }
  }
}

export default AuthHelpers;