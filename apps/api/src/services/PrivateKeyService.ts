import crypto from 'crypto';
import { ethers } from 'ethers';
import redis from '@/config/redis';
import { logger } from '@/utils/logger';
import env from '@/config/env';

export interface EncryptedPrivateKey {
  encryptedData: string;
  iv: string;
  salt: string;
  keyId: string;
}

export interface SessionKeyData {
  sessionKey: string;
  userAddress: string;
  encryptedPrivateKey: EncryptedPrivateKey;
  expiresAt: number;
  permissions: string[];
}

export class PrivateKeyService {
  private static readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
  private static readonly SESSION_KEY_PREFIX = 'session_key:';
  private static readonly ENCRYPTED_KEY_PREFIX = 'encrypted_key:';
  private static readonly DEFAULT_SESSION_EXPIRY = 30 * 60 * 1000; // 30 minutes

  /**
   * Generate a new session key for user operations
   */
  static generateSessionKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Encrypt private key using AES-256-GCM with user-specific salt
   */
  static encryptPrivateKey(privateKey: string, userAddress: string): EncryptedPrivateKey {
    try {
      // Generate salt using user address and timestamp
      const salt = crypto.scryptSync(userAddress.toLowerCase(), 'copil-salt', 32);
      const iv = crypto.randomBytes(16);
      const keyId = crypto.createHash('sha256').update(userAddress + Date.now()).digest('hex').substring(0, 16);

      // Derive encryption key
      const key = crypto.scryptSync(env.JWT_SECRET || 'fallback-secret', salt, 32);
      
      // Create cipher
      const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
      
      // Encrypt private key
      let encryptedData = cipher.update(privateKey, 'utf8', 'hex');
      encryptedData += cipher.final('hex');
      
      // Get authentication tag
      const authTag = cipher.getAuthTag();
      
      return {
        encryptedData: encryptedData + ':' + authTag.toString('hex'),
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        keyId
      };
    } catch (error) {
      logger.error('Failed to encrypt private key:', error);
      throw new Error('Private key encryption failed');
    }
  }

  /**
   * Decrypt private key using stored encryption data
   */
  static decryptPrivateKey(encryptedKey: EncryptedPrivateKey, userAddress: string): string {
    try {
      const salt = Buffer.from(encryptedKey.salt, 'hex');
      const iv = Buffer.from(encryptedKey.iv, 'hex');
      
      // Split encrypted data and auth tag
      const [encryptedData, authTagHex] = encryptedKey.encryptedData.split(':');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      // Derive same encryption key
      const key = crypto.scryptSync(env.JWT_SECRET || 'fallback-secret', salt, 32);
      
      // Create decipher
      const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
      decipher.setAuthTag(authTag);
      
      // Decrypt
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      // Validate decrypted private key format
      if (!decrypted.startsWith('0x') || decrypted.length !== 66) {
        throw new Error('Invalid decrypted private key format');
      }
      
      return decrypted;
    } catch (error) {
      logger.error('Failed to decrypt private key:', error);
      throw new Error('Private key decryption failed');
    }
  }

  /**
   * Create secure session key for user operations
   */
  static async createSecureSession(
    userAddress: string, 
    privateKey: string,
    permissions: string[] = ['read', 'write'],
    expiryMinutes: number = 30
  ): Promise<string> {
    try {
      // Generate session key
      const sessionKey = this.generateSessionKey();
      
      // Encrypt private key
      const encryptedPrivateKey = this.encryptPrivateKey(privateKey, userAddress);
      
      // Create session data
      const sessionData: SessionKeyData = {
        sessionKey,
        userAddress: userAddress.toLowerCase(),
        encryptedPrivateKey,
        expiresAt: Date.now() + (expiryMinutes * 60 * 1000),
        permissions
      };
      
      // Store session in Redis
      const key = `${this.SESSION_KEY_PREFIX}${sessionKey}`;
      const expireSeconds = expiryMinutes * 60;
      
      await redis.set(key, JSON.stringify(sessionData), expireSeconds);
      
      logger.info(`Secure session created for ${userAddress} (${sessionKey.substring(0, 8)}...)`);
      
      return sessionKey;
    } catch (error) {
      logger.error('Failed to create secure session:', error);
      throw new Error('Session creation failed');
    }
  }

  /**
   * Retrieve and validate session key
   */
  static async getSessionData(sessionKey: string): Promise<SessionKeyData | null> {
    try {
      const key = `${this.SESSION_KEY_PREFIX}${sessionKey}`;
      const data = await redis.get(key);
      
      if (!data) {
        logger.warn(`Session not found: ${sessionKey.substring(0, 8)}...`);
        return null;
      }
      
      const sessionData: SessionKeyData = JSON.parse(data);
      
      // Check expiration
      if (Date.now() > sessionData.expiresAt) {
        logger.warn(`Session expired: ${sessionKey.substring(0, 8)}...`);
        await this.invalidateSession(sessionKey);
        return null;
      }
      
      return sessionData;
    } catch (error) {
      logger.error('Failed to get session data:', error);
      return null;
    }
  }

  /**
   * Get decrypted private key from session
   */
  static async getPrivateKeyFromSession(sessionKey: string): Promise<string | null> {
    try {
      const sessionData = await this.getSessionData(sessionKey);
      if (!sessionData) {
        return null;
      }
      
      const privateKey = this.decryptPrivateKey(
        sessionData.encryptedPrivateKey, 
        sessionData.userAddress
      );
      
      return privateKey;
    } catch (error) {
      logger.error('Failed to get private key from session:', error);
      return null;
    }
  }

  /**
   * Invalidate session key
   */
  static async invalidateSession(sessionKey: string): Promise<void> {
    try {
      const key = `${this.SESSION_KEY_PREFIX}${sessionKey}`;
      await redis.del(key);
      
      logger.info(`Session invalidated: ${sessionKey.substring(0, 8)}...`);
    } catch (error) {
      logger.error('Failed to invalidate session:', error);
    }
  }

  /**
   * Rotate session key (create new, invalidate old)
   */
  static async rotateSession(oldSessionKey: string): Promise<string | null> {
    try {
      const oldSessionData = await this.getSessionData(oldSessionKey);
      if (!oldSessionData) {
        return null;
      }
      
      // Get private key from old session
      const privateKey = await this.getPrivateKeyFromSession(oldSessionKey);
      if (!privateKey) {
        return null;
      }
      
      // Create new session
      const newSessionKey = await this.createSecureSession(
        oldSessionData.userAddress,
        privateKey,
        oldSessionData.permissions
      );
      
      // Invalidate old session
      await this.invalidateSession(oldSessionKey);
      
      logger.info(`Session rotated for ${oldSessionData.userAddress}`);
      
      return newSessionKey;
    } catch (error) {
      logger.error('Failed to rotate session:', error);
      return null;
    }
  }

  /**
   * Validate user permissions for operation
   */
  static async hasPermission(sessionKey: string, requiredPermission: string): Promise<boolean> {
    try {
      const sessionData = await this.getSessionData(sessionKey);
      if (!sessionData) {
        return false;
      }
      
      return sessionData.permissions.includes(requiredPermission) || 
             sessionData.permissions.includes('admin');
    } catch (error) {
      logger.error('Failed to check permissions:', error);
      return false;
    }
  }

  /**
   * Store encrypted private key for long-term storage (database)
   */
  static async storeEncryptedKey(userAddress: string, privateKey: string): Promise<string> {
    try {
      const encryptedKey = this.encryptPrivateKey(privateKey, userAddress);
      const keyId = encryptedKey.keyId;
      
      // Store in Redis for quick access
      const key = `${this.ENCRYPTED_KEY_PREFIX}${keyId}`;
      await redis.set(key, JSON.stringify(encryptedKey), 24 * 60 * 60); // 24 hours
      
      logger.info(`Encrypted private key stored for ${userAddress} (${keyId})`);
      
      return keyId;
    } catch (error) {
      logger.error('Failed to store encrypted key:', error);
      throw new Error('Key storage failed');
    }
  }

  /**
   * Retrieve encrypted private key by ID
   */
  static async getEncryptedKey(keyId: string): Promise<EncryptedPrivateKey | null> {
    try {
      const key = `${this.ENCRYPTED_KEY_PREFIX}${keyId}`;
      const data = await redis.get(key);
      
      if (!data) {
        return null;
      }
      
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to get encrypted key:', error);
      return null;
    }
  }

  /**
   * Clean up expired sessions and keys
   */
  static async cleanupExpiredSessions(): Promise<void> {
    try {
      const pattern = `${this.SESSION_KEY_PREFIX}*`;
      const keys = await redis.client.keys(pattern);
      let cleaned = 0;
      
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const sessionData: SessionKeyData = JSON.parse(data);
          if (Date.now() > sessionData.expiresAt) {
            await redis.del(key);
            cleaned++;
          }
        }
      }
      
      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired sessions`);
      }
    } catch (error) {
      logger.error('Failed to cleanup expired sessions:', error);
    }
  }

  /**
   * Generate secure random private key for testing/development
   */
  static generatePrivateKey(): string {
    const wallet = ethers.Wallet.createRandom();
    return wallet.privateKey;
  }

  /**
   * Validate private key format and derive address
   */
  static validatePrivateKey(privateKey: string): { isValid: boolean; address?: string } {
    try {
      if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
        return { isValid: false };
      }
      
      const wallet = new ethers.Wallet(privateKey);
      return { isValid: true, address: wallet.address };
    } catch (error) {
      return { isValid: false };
    }
  }
}

export default PrivateKeyService;
