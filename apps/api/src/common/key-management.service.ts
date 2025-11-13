import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Hex } from 'viem';

/**
 * Key Management Service
 *
 * Provides secure storage and retrieval of private keys using HashiCorp Vault.
 * Falls back to environment variables for development/testing only.
 *
 * **IMPORTANT**: In production, VAULT_ENABLED must be set to 'true'.
 */
@Injectable()
export class KeyManagementService implements OnModuleInit {
  private readonly logger = new Logger(KeyManagementService.name);
  private vaultEnabled: boolean = false;
  private vaultToken?: string;
  private vaultUrl?: string;
  private vaultNamespace?: string;
  private vaultMountPath: string = 'secret';
  private keyCache: Map<string, { key: string; expiresAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    // Check if Vault is enabled
    this.vaultEnabled = this.configService.get<string>('VAULT_ENABLED') === 'true';

    if (this.vaultEnabled) {
      this.vaultUrl = this.configService.get<string>('VAULT_URL');
      this.vaultToken = this.configService.get<string>('VAULT_TOKEN');
      this.vaultNamespace = this.configService.get<string>('VAULT_NAMESPACE');
      this.vaultMountPath = this.configService.get<string>('VAULT_MOUNT_PATH') || 'secret';

      if (!this.vaultUrl || !this.vaultToken) {
        this.logger.error('VAULT_ENABLED is true but VAULT_URL or VAULT_TOKEN is missing!');
        throw new Error('Vault configuration incomplete. Set VAULT_URL and VAULT_TOKEN.');
      }

      this.logger.log('✅ HashiCorp Vault integration enabled');
      this.logger.log(`Vault URL: ${this.vaultUrl}`);
      this.logger.log(`Vault Mount Path: ${this.vaultMountPath}`);

      // Test connection
      await this.testVaultConnection();
    } else {
      const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
      if (isProduction) {
        this.logger.warn('⚠️  PRODUCTION MODE: Vault is disabled! Private keys will be read from environment variables.');
        this.logger.warn('⚠️  This is INSECURE. Set VAULT_ENABLED=true and configure Vault.');
      } else {
        this.logger.log('🔓 Development mode: Using environment variables for private keys');
      }
    }
  }

  /**
   * Test Vault connection by reading server health
   */
  private async testVaultConnection(): Promise<void> {
    try {
      const response = await fetch(`${this.vaultUrl}/v1/sys/health`, {
        method: 'GET',
        headers: this.getVaultHeaders(),
      });

      if (response.ok) {
        this.logger.log('✅ Vault connection successful');
      } else {
        this.logger.error(`⚠️ Vault health check failed: ${response.status} ${response.statusText}`);
        throw new Error('Vault health check failed');
      }
    } catch (error) {
      this.logger.error(`Failed to connect to Vault: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get session key for EVM chains (returns hex string)
   */
  async getSessionKey(sessionKeyId: number): Promise<Hex | undefined> {
    const key = await this.getKey(`session-key-${sessionKeyId}`);
    if (key) {
      return key.startsWith('0x') ? (key as Hex) : `0x${key}`;
    }

    // Fallback to environment variable (deprecated)
    return this.getSessionKeyFromEnv(sessionKeyId);
  }

  /**
   * Get session key for Solana (returns Uint8Array)
   */
  async getSessionKeyBytes(sessionKeyId: number): Promise<Uint8Array | undefined> {
    const key = await this.getKey(`session-key-${sessionKeyId}-bytes`);
    if (key) {
      try {
        return Uint8Array.from(JSON.parse(key));
      } catch (error) {
        this.logger.error(`Failed to parse session key bytes: ${error instanceof Error ? error.message : 'Unknown'}`);
        return undefined;
      }
    }

    const keyB58 = await this.getKey(`session-key-${sessionKeyId}-b58`);
    if (keyB58) {
      try {
        // Lazy load bs58 to avoid dependency if not needed
        const bs58 = await import('bs58');
        return bs58.default.decode(keyB58);
      } catch (error) {
        this.logger.error(`Failed to decode Base58 key: ${error instanceof Error ? error.message : 'Unknown'}`);
        return undefined;
      }
    }

    // Fallback to environment variable (deprecated)
    return this.getSessionKeyBytesFromEnv(sessionKeyId);
  }

  /**
   * Store a session key securely in Vault
   */
  async storeSessionKey(sessionKeyId: number, privateKey: string, chainType: 'evm' | 'solana' = 'evm'): Promise<void> {
    const keyPath = chainType === 'evm' ? `session-key-${sessionKeyId}` : `session-key-${sessionKeyId}-bytes`;
    await this.storeKey(keyPath, privateKey);
    this.logger.log(`Session key ${sessionKeyId} stored securely in Vault (${chainType})`);
  }

  /**
   * Delete a session key from Vault
   */
  async deleteSessionKey(sessionKeyId: number): Promise<void> {
    await this.deleteKey(`session-key-${sessionKeyId}`);
    await this.deleteKey(`session-key-${sessionKeyId}-bytes`);
    await this.deleteKey(`session-key-${sessionKeyId}-b58`);
    this.logger.log(`Session key ${sessionKeyId} deleted from Vault`);
  }

  /**
   * Rotate a session key (delete old, store new)
   */
  async rotateSessionKey(sessionKeyId: number, newPrivateKey: string, chainType: 'evm' | 'solana' = 'evm'): Promise<void> {
    await this.deleteSessionKey(sessionKeyId);
    await this.storeSessionKey(sessionKeyId, newPrivateKey, chainType);
    this.logger.log(`Session key ${sessionKeyId} rotated successfully`);
  }

  /**
   * Generic method to get a key from Vault or cache
   */
  private async getKey(keyPath: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.keyCache.get(keyPath);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.key;
    }

    if (!this.vaultEnabled) {
      return undefined;
    }

    try {
      const path = `${this.vaultMountPath}/data/${keyPath}`;
      const response = await fetch(`${this.vaultUrl}/v1/${path}`, {
        method: 'GET',
        headers: this.getVaultHeaders(),
      });

      if (response.status === 404) {
        this.logger.debug(`Key not found in Vault: ${keyPath}`);
        return undefined;
      }

      if (!response.ok) {
        this.logger.error(`Failed to read key from Vault: ${response.status} ${response.statusText}`);
        return undefined;
      }

      const data = await response.json();
      const privateKey = data?.data?.data?.privateKey;

      if (!privateKey) {
        this.logger.error(`Key ${keyPath} exists but has no privateKey field`);
        return undefined;
      }

      // Cache the key
      this.keyCache.set(keyPath, {
        key: privateKey,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });

      return privateKey;
    } catch (error) {
      this.logger.error(`Error reading key from Vault: ${error instanceof Error ? error.message : 'Unknown'}`);
      return undefined;
    }
  }

  /**
   * Generic method to store a key in Vault
   */
  private async storeKey(keyPath: string, privateKey: string): Promise<void> {
    if (!this.vaultEnabled) {
      throw new Error('Cannot store key: Vault is not enabled');
    }

    try {
      const path = `${this.vaultMountPath}/data/${keyPath}`;
      const response = await fetch(`${this.vaultUrl}/v1/${path}`, {
        method: 'POST',
        headers: {
          ...this.getVaultHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            privateKey,
            createdAt: new Date().toISOString(),
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Failed to store key in Vault: ${response.status} ${errorText}`);
        throw new Error(`Failed to store key in Vault: ${response.status}`);
      }

      // Invalidate cache
      this.keyCache.delete(keyPath);

      this.logger.log(`Key stored successfully in Vault: ${keyPath}`);
    } catch (error) {
      this.logger.error(`Error storing key in Vault: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw error;
    }
  }

  /**
   * Delete a key from Vault
   */
  private async deleteKey(keyPath: string): Promise<void> {
    if (!this.vaultEnabled) {
      this.logger.debug('Vault not enabled, skipping key deletion');
      return;
    }

    try {
      const path = `${this.vaultMountPath}/metadata/${keyPath}`;
      const response = await fetch(`${this.vaultUrl}/v1/${path}`, {
        method: 'DELETE',
        headers: this.getVaultHeaders(),
      });

      if (response.ok || response.status === 404) {
        this.logger.log(`Key deleted from Vault: ${keyPath}`);
        this.keyCache.delete(keyPath);
      } else {
        this.logger.error(`Failed to delete key from Vault: ${response.status}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting key from Vault: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * Get Vault HTTP headers
   */
  private getVaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Vault-Token': this.vaultToken!,
    };

    if (this.vaultNamespace) {
      headers['X-Vault-Namespace'] = this.vaultNamespace;
    }

    return headers;
  }

  /**
   * DEPRECATED: Fallback to environment variables (for backward compatibility)
   */
  private getSessionKeyFromEnv(sessionKeyId: number): Hex | undefined {
    const key = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY`);
    if (key) {
      this.logger.warn(`⚠️ Using environment variable for session key ${sessionKeyId}. Migrate to Vault!`);
      return key.startsWith('0x') ? (key as Hex) : `0x${key}`;
    }

    const fallback = this.configService.get<string>('SESSION_KEY_PRIVATE_KEY');
    if (fallback) {
      this.logger.warn(`⚠️ Using fallback environment variable for session key. Migrate to Vault!`);
      return fallback.startsWith('0x') ? (fallback as Hex) : `0x${fallback}`;
    }

    return undefined;
  }

  /**
   * DEPRECATED: Fallback to environment variables for Solana keys
   */
  private getSessionKeyBytesFromEnv(sessionKeyId: number): Uint8Array | undefined {
    const keyBytes = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY_BYTES`);
    if (keyBytes) {
      try {
        this.logger.warn(`⚠️ Using environment variable for Solana session key ${sessionKeyId}. Migrate to Vault!`);
        return Uint8Array.from(JSON.parse(keyBytes));
      } catch (error) {
        this.logger.error('Failed to parse SESSION_KEY_..._PRIVATE_KEY_BYTES from env');
        return undefined;
      }
    }

    const keyB58 = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY_B58`);
    if (keyB58) {
      try {
        const bs58 = require('bs58');
        this.logger.warn(`⚠️ Using environment variable (B58) for Solana session key ${sessionKeyId}. Migrate to Vault!`);
        return bs58.decode(keyB58);
      } catch (error) {
        this.logger.error('Failed to decode Base58 private key from env');
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Clear the key cache (useful for testing or security events)
   */
  clearCache(): void {
    this.keyCache.clear();
    this.logger.log('Key cache cleared');
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.keyCache.size,
      keys: Array.from(this.keyCache.keys()),
    };
  }
}
