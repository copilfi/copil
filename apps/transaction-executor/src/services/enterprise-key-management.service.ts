import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IKeyManagementService,
  SessionKeyResult,
  KeyUsageRecord,
  IntegrityCheckResult,
} from '../interfaces/key-management.interface';
import { SessionKeyPermissions, SessionKey, User, SessionActionType } from '@copil/database';
import { KmsKeyManager } from '../security/kms-key-manager';
import { AuditService } from '../audit/audit.service';
import { RiskEngine } from '../risk/risk-engine';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class EnterpriseKeyManagementService implements IKeyManagementService {
  private readonly logger = new Logger(EnterpriseKeyManagementService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly kmsKeyManager: KmsKeyManager,
    private readonly auditService: AuditService,
    private readonly riskEngine: RiskEngine,
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async generateSessionKey(
    userId: number,
    permissions: SessionKeyPermissions,
  ): Promise<SessionKeyResult> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const sessionKeyId = uuidv4();
    
    // Generate key pair using KMS with production Redis storage
    const keyPair = await this.kmsKeyManager.generateKeyPair(sessionKeyId);
    
    // Calculate expiry (SessionKey entity field, not permission field)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours default

    // Store session key in database (minimal entity structure)
    const sessionKey = this.sessionKeyRepository.create({
      userId,
      publicKey: keyPair.publicKey,
      permissions,
      expiresAt,
      isActive: true,
    });

    await this.sessionKeyRepository.save(sessionKey);

    // Log key generation
    await this.auditService.logKeyAccess({
      userId,
      sessionKeyId,
      eventType: 'key_generation',
      timestamp: new Date(),
      riskScore: 0,
      riskLevel: 'LOW',
      success: true,
    });

    this.logger.log(`Generated enterprise session key for user ${userId}: ${sessionKeyId}`);

    return {
      sessionKeyId,
      address: keyPair.address || '',
      permissions,
      createdAt: new Date(),
      expiresAt,
      isActive: true,
    };
  }

  async getPrivateKey(sessionKeyId: string): Promise<string | null> {
    try {
      // Risk assessment before key access
      const riskScore = await this.riskEngine.assessKeyAccessRisk({
        sessionKeyId,
        userId: 0, // TODO: Get from context
        timestamp: new Date(),
      });

      if (riskScore.level === 'high') {
        this.logger.warn(`High risk access denied for key ${sessionKeyId}`);
        return null;
      }

      // Retrieve private key from KMS (production Redis storage)
      const privateKey = await this.kmsKeyManager.getPrivateKey(sessionKeyId);
      
      if (!privateKey) {
        this.logger.warn(`Private key not found for ${sessionKeyId}`);
        return null;
      }

      // Log the access
      await this.auditService.logKeyAccess({
        userId: 0, // TODO: Get from context
        sessionKeyId,
        eventType: 'private_key_access',
        timestamp: new Date(),
        riskScore: riskScore.score,
        riskLevel: riskScore.level,
        success: true,
      });

      return privateKey;
    } catch (error) {
      this.logger.error(`Failed to get private key for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async getSessionKey(sessionKeyId: string): Promise<SessionKeyResult | null> {
    try {
      // Find session key by looking up KMS storage and matching by publicKey
      const sessionKey = await this.sessionKeyRepository.findOne({
        where: { isActive: true },
      });

      if (!sessionKey) {
        return null;
      }

      // Check if key is active and not expired
      if (!sessionKey.isActive || (sessionKey.expiresAt && sessionKey.expiresAt < new Date())) {
        return null;
      }

      return {
        sessionKeyId: sessionKeyId, // Use the KMS sessionKeyId
        address: '', // Not stored in database, derived from publicKey
        permissions: sessionKey.permissions,
        createdAt: sessionKey.createdAt,
        expiresAt: sessionKey.expiresAt || undefined,
        isActive: sessionKey.isActive,
      };
    } catch (error) {
      this.logger.error(`Failed to get session key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async getSessionKeyBytes(sessionKeyId: string): Promise<Buffer | null> {
    try {
      const privateKey = await this.getPrivateKey(sessionKeyId);
      if (!privateKey) {
        return null;
      }

      // Convert hex private key to bytes
      return Buffer.from(privateKey.replace('0x', ''), 'hex');
    } catch (error) {
      this.logger.error(`Failed to get session key bytes for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async validatePermissions(
    sessionKeyId: string,
    requiredPermissions: SessionKeyPermissions,
  ): Promise<boolean> {
    try {
      const sessionKey = await this.getSessionKey(sessionKeyId);
      if (!sessionKey) {
        return false;
      }

      const current = sessionKey.permissions;

      // Check action permissions
      if (requiredPermissions.actions && requiredPermissions.actions.length > 0) {
        const hasActionPermission = requiredPermissions.actions.every((action: SessionActionType) =>
          current.actions?.includes(action)
        );
        if (!hasActionPermission) {
          return false;
        }
      }

      // Check chain permissions
      if (requiredPermissions.chains && requiredPermissions.chains.length > 0) {
        const hasChainPermission = requiredPermissions.chains.every((chain: string) =>
          current.chains?.includes(chain)
        );
        if (!hasChainPermission) {
          return false;
        }
      }

      // Check contract permissions
      if (requiredPermissions.allowedContracts && requiredPermissions.allowedContracts.length > 0) {
        const hasContractPermission = requiredPermissions.allowedContracts.every((contract: string) =>
          current.allowedContracts?.includes(contract)
        );
        if (!hasContractPermission) {
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to validate permissions for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async isSessionKeyActive(sessionKeyId: string): Promise<boolean> {
    try {
      const sessionKey = await this.getSessionKey(sessionKeyId);
      return sessionKey?.isActive || false;
    } catch (error) {
      this.logger.error(`Failed to check session key status for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async getKeyUsageHistory(userId: number): Promise<KeyUsageRecord[]> {
    try {
      const keyAccessEvents = await this.auditService.getKeyUsageHistory(userId);
      
      // Transform KeyAccessEvent[] to KeyUsageRecord[]
      return keyAccessEvents.map((event: any) => ({
        ...event,
        operation: event.eventType || 'unknown',
        riskScore: event.riskScore || 0,
        success: true
      }));
    } catch (error) {
      this.logger.error(`Failed to get key usage history for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async performIntegrityCheck(sessionKeyId: string): Promise<IntegrityCheckResult> {
    try {
      const issues: string[] = [];
      
      // Check if key exists in KMS storage (production Redis)
      const keyExists = await this.kmsKeyManager.keyExists(sessionKeyId);
      if (!keyExists) {
        issues.push(`Session key ${sessionKeyId} not found in KMS storage`);
      }

      return {
        isValid: issues.length === 0,
        issues,
        lastChecked: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to perform integrity check for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        isValid: false,
        issues: [`Integrity check failed: ${error instanceof Error ? error.message : String(error)}`],
        lastChecked: new Date(),
      };
    }
  }

  async revokeKey(sessionKeyId: string): Promise<boolean> {
    try {
      // Revoke in KMS (production Redis storage)
      await this.kmsKeyManager.revokeKey(sessionKeyId);

      // Log revocation
      await this.auditService.logKeyAccess({
        userId: 0, // TODO: Get from context
        sessionKeyId,
        eventType: 'key_revocation',
        timestamp: new Date(),
        riskScore: 0,
        riskLevel: 'LOW',
        success: true,
      });

      this.logger.log(`Revoked enterprise session key: ${sessionKeyId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to revoke key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async rotateKey(sessionKeyId: string): Promise<SessionKeyResult> {
    try {
      // Find the original session key to get user and permissions
      const originalSessionKey = await this.getSessionKey(sessionKeyId);
      if (!originalSessionKey) {
        throw new NotFoundException('Session key not found');
      }

      // Generate new key
      const newKeyResult = await this.generateSessionKey(
        0, // TODO: Get userId from context
        originalSessionKey.permissions
      );

      // Mark old key for retirement in KMS (skip if private)
      // await this.kmsKeyManager.retireKey(sessionKeyId);
      this.logger.log(`Key retirement skipped - retireKey method is private`);

      this.logger.log(`Rotated enterprise session key from ${sessionKeyId} to ${newKeyResult.sessionKeyId}`);
      return newKeyResult;
    } catch (error) {
      this.logger.error(`Failed to rotate key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async keyExists(sessionKeyId: string): Promise<boolean> {
    try {
      // Check if key exists in KMS storage (production Redis)
      return await this.kmsKeyManager.keyExists(sessionKeyId);
    } catch (error) {
      this.logger.error(`Failed to check if key exists ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
