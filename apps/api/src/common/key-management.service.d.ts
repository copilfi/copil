import { OnModuleInit } from '@nestjs/common';
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
export declare class KeyManagementService implements OnModuleInit {
    private readonly configService;
    private readonly logger;
    private vaultEnabled;
    private vaultToken?;
    private vaultUrl?;
    private vaultNamespace?;
    private vaultMountPath;
    private keyCache;
    private readonly CACHE_TTL_MS;
    constructor(configService: ConfigService);
    onModuleInit(): Promise<void>;
    /**
     * Test Vault connection by reading server health
     */
    private testVaultConnection;
    /**
     * Get session key for EVM chains (returns hex string)
     */
    getSessionKey(sessionKeyId: number): Promise<Hex | undefined>;
    /**
     * Get session key for Solana (returns Uint8Array)
     */
    getSessionKeyBytes(sessionKeyId: number): Promise<Uint8Array | undefined>;
    /**
     * Store a session key securely in Vault
     */
    storeSessionKey(sessionKeyId: number, privateKey: string, chainType?: 'evm' | 'solana'): Promise<void>;
    /**
     * Delete a session key from Vault
     */
    deleteSessionKey(sessionKeyId: number): Promise<void>;
    /**
     * Rotate a session key (delete old, store new)
     */
    rotateSessionKey(sessionKeyId: number, newPrivateKey: string, chainType?: 'evm' | 'solana'): Promise<void>;
    /**
     * Generic method to get a key from Vault or cache
     */
    private getKey;
    /**
     * Generic method to store a key in Vault
     */
    private storeKey;
    /**
     * Delete a key from Vault
     */
    private deleteKey;
    /**
     * Get Vault HTTP headers
     */
    private getVaultHeaders;
    /**
     * DEPRECATED: Fallback to environment variables (for backward compatibility)
     */
    private getSessionKeyFromEnv;
    /**
     * DEPRECATED: Fallback to environment variables for Solana keys
     */
    private getSessionKeyBytesFromEnv;
    /**
     * Clear the key cache (useful for testing or security events)
     */
    clearCache(): void;
    /**
     * Get cache statistics (for monitoring)
     */
    getCacheStats(): {
        size: number;
        keys: string[];
    };
}
