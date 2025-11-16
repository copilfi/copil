import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Storage interfaces for type safety
export interface StoredEncryptedKey {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
  revoked?: boolean;
  revokedAt?: string;
  retired?: boolean;
  retiredAt?: string;
  storedAt: string;
  version: string;
}

export interface StoredDataKey {
  keyId: string;
  encryptedData: string;
  createdAt: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly redis: Redis;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {
    // Initialize Redis client with production-ready configuration
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: parseInt(this.configService.get<string>('REDIS_PORT', '6379')),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: parseInt(this.configService.get<string>('REDIS_DB', '0')),
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // Production-ready settings
      commandTimeout: 5000,
      connectTimeout: 10000,
      family: 4,
      keepAlive: 30000,
    });

    this.setupRedisEventHandlers();
  }

  private setupRedisEventHandlers(): void {
    this.redis.on('connect', () => {
      this.logger.log('✅ Redis connected successfully');
      this.isConnected = true;
    });

    this.redis.on('error', (error) => {
      this.logger.error(`❌ Redis connection error: ${error.message}`);
      this.isConnected = false;
    });

    this.redis.on('close', () => {
      this.logger.warn('⚠️ Redis connection closed');
      this.isConnected = false;
    });

    this.redis.on('reconnecting', () => {
      this.logger.log('🔄 Redis reconnecting...');
    });
  }

  async storeEncryptedKey(
    sessionKeyId: string,
    encryptedData: Omit<StoredEncryptedKey, 'storedAt' | 'version'>
  ): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.redis.connect();
      }

      const storageKey = `encrypted_key:${sessionKeyId}`;
      const storedData: StoredEncryptedKey = {
        ...encryptedData,
        storedAt: new Date().toISOString(),
        version: '1.0',
      };

      // Store with 30 days expiry for production
      await this.redis.setex(storageKey, 30 * 24 * 60 * 60, JSON.stringify(storedData));
      
      this.logger.debug(`Successfully stored encrypted key for ${sessionKeyId}`);
    } catch (error) {
      this.logger.error(
        `Failed to store encrypted key for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async retrieveEncryptedKey(sessionKeyId: string): Promise<StoredEncryptedKey | null> {
    try {
      if (!this.isConnected) {
        await this.redis.connect();
      }

      const storageKey = `encrypted_key:${sessionKeyId}`;
      const storedData = await this.redis.get(storageKey);

      if (!storedData) {
        this.logger.warn(`No encrypted key found for ${sessionKeyId}`);
        return null;
      }

      const parsedData: StoredEncryptedKey = JSON.parse(storedData);

      // Check if key is revoked
      if (parsedData.revoked) {
        this.logger.warn(`Key ${sessionKeyId} is revoked`);
        return null;
      }

      // Check if key is retired
      if (parsedData.retired) {
        this.logger.warn(`Key ${sessionKeyId} is retired`);
        return null;
      }

      return parsedData;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve encrypted key for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async storeDataKey(keyId: string, encryptedDataKey: string): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.redis.connect();
      }

      const storageKey = `data_key:${keyId}`;
      const storedData: StoredDataKey = {
        keyId,
        encryptedData: encryptedDataKey,
        createdAt: new Date().toISOString(),
      };

      // Store with 30 days expiry
      await this.redis.setex(storageKey, 30 * 24 * 60 * 60, JSON.stringify(storedData));
      
      this.logger.debug(`Successfully stored data key for ${keyId}`);
    } catch (error) {
      this.logger.error(
        `Failed to store data key for ${keyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async retrieveDataKey(keyId: string): Promise<string | null> {
    try {
      if (!this.isConnected) {
        await this.redis.connect();
      }

      const storageKey = `data_key:${keyId}`;
      const storedData = await this.redis.get(storageKey);

      if (!storedData) {
        this.logger.warn(`No data key found for ${keyId}`);
        return null;
      }

      const parsedData: StoredDataKey = JSON.parse(storedData);
      return parsedData.encryptedData;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve data key for ${keyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async markKeyAsRevoked(sessionKeyId: string): Promise<void> {
    try {
      const storedData = await this.retrieveEncryptedKey(sessionKeyId);
      
      if (!storedData) {
        this.logger.warn(`Cannot revoke non-existent key: ${sessionKeyId}`);
        return;
      }

      storedData.revoked = true;
      storedData.revokedAt = new Date().toISOString();

      await this.storeEncryptedKey(sessionKeyId, storedData);
      this.logger.debug(`Successfully marked key ${sessionKeyId} as revoked`);
    } catch (error) {
      this.logger.error(
        `Failed to mark key ${sessionKeyId} as revoked: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async retireKey(sessionKeyId: string): Promise<void> {
    try {
      const storedData = await this.retrieveEncryptedKey(sessionKeyId);
      
      if (!storedData) {
        this.logger.warn(`Cannot retire non-existent key: ${sessionKeyId}`);
        return;
      }

      storedData.retired = true;
      storedData.retiredAt = new Date().toISOString();

      // Store with 7 days expiry for retired keys
      const storageKey = `encrypted_key:${sessionKeyId}`;
      await this.redis.setex(storageKey, 7 * 24 * 60 * 60, JSON.stringify(storedData));
      
      this.logger.debug(`Successfully retired key ${sessionKeyId}`);
    } catch (error) {
      this.logger.error(
        `Failed to retire key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async keyExists(sessionKeyId: string): Promise<boolean> {
    try {
      const storedData = await this.retrieveEncryptedKey(sessionKeyId);
      return storedData !== null;
    } catch (error) {
      return false;
    }
  }

  async deleteKey(sessionKeyId: string): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.redis.connect();
      }

      const encryptedKeyKey = `encrypted_key:${sessionKeyId}`;
      await this.redis.del(encryptedKeyKey);
      
      this.logger.debug(`Successfully deleted key ${sessionKeyId}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Redis connection closed gracefully');
    } catch (error) {
      this.logger.error(`Error closing Redis connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
