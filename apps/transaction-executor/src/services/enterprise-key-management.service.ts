import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { 
  IEnterpriseKeyManagementService, 
  SecurityContext, 
  SessionKeyPermissions,
  SessionKeyResult,
  ThresholdOperationRequest,
  ThresholdOperationResult,
  AccessValidationResult,
  KeyUsageRecord,
  IntegrityCheckResult
} from '@copil/database';
import { SessionKey, User } from '@copil/database';
import { KmsKeyManager } from '../security/kms-key-manager';
import { AuditService } from '../audit/audit.service';
import { RiskEngine } from '../risk/risk-engine';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class EnterpriseKeyManagementService implements IEnterpriseKeyManagementService {
  private readonly logger = new Logger(EnterpriseKeyManagementService.name);
  private readonly kmsKeyManager: KmsKeyManager;
  private readonly riskEngine: RiskEngine;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly auditService: AuditService,
  ) {
    this.kmsKeyManager = new KmsKeyManager(configService);
    this.riskEngine = new RiskEngine(configService);
  }

  async generateSessionKey(
    userId: number, 
    permissions: SessionKeyPermissions
  ): Promise<SessionKeyResult> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const sessionKeyId = uuidv4();
    
    // Generate key pair in KMS/HSM
    const keyPair = await this.kmsKeyManager.generateKeyPair(sessionKeyId);
    
    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days default

    // Store session key metadata (public key only)
    const sessionKey = this.sessionKeyRepository.create({
      id: sessionKeyId,
      userId,
      publicKey: keyPair.publicKey,
      permissions,
      expiresAt,
      isActive: true,
    });

    await this.sessionKeyRepository.save(sessionKey);

    // Audit log
    await this.auditService.logKeyGeneration({
      userId,
      sessionKeyId,
      permissions,
      timestamp: new Date(),
    });

    this.logger.log(`Generated session key ${sessionKeyId} for user ${userId}`);

    return {
      sessionKeyId,
      publicKey: keyPair.publicKey,
      address: keyPair.address, // EVM address if applicable
      expiresAt,
      permissions,
    };
  }

  async getPrivateKey(
    sessionKeyId: string, 
    context: SecurityContext
  ): Promise<string | null> {
    // Validate access request
    const accessValidation = await this.validateKeyAccess(sessionKeyId, context);
    if (!accessValidation.allowed) {
      throw new UnauthorizedException(accessValidation.reason);
    }

    // Additional security checks for high-risk operations
    if (accessValidation.riskLevel === 'critical' && !context.mfaVerified) {
      throw new UnauthorizedException('MFA required for high-risk operations');
    }

    try {
      // Retrieve private key from KMS/HSM
      const privateKey = await this.kmsKeyManager.getPrivateKey(sessionKeyId);
      
      // Audit the access
      await this.auditService.logKeyAccess({
        sessionKeyId,
        userId: context.userId,
        riskLevel: accessValidation.riskLevel,
        timestamp: new Date(),
        success: true,
      });

      return privateKey;
    } catch (error) {
      this.logger.error(`Failed to retrieve private key for ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      
      // Audit failed access
      await this.auditService.logKeyAccess({
        sessionKeyId,
        userId: context.userId,
        riskLevel: accessValidation.riskLevel,
        timestamp: new Date(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      return null;
    }
  }

  async validateKeyAccess(
    sessionKeyId: string, 
    context: SecurityContext
  ): Promise<AccessValidationResult> {
    const sessionKey = await this.sessionKeyRepository.findOne({
      where: { id: sessionKeyId },
      relations: ['user'],
    });

    if (!sessionKey) {
      return { allowed: false, reason: 'Session key not found', riskLevel: 'high' };
    }

    if (!sessionKey.isActive) {
      return { allowed: false, reason: 'Session key is inactive', riskLevel: 'medium' };
    }

    if (sessionKey.expiresAt && sessionKey.expiresAt < new Date()) {
      return { allowed: false, reason: 'Session key expired', riskLevel: 'medium' };
    }

    if (sessionKey.userId !== context.userId) {
      return { allowed: false, reason: 'Unauthorized user access', riskLevel: 'critical' };
    }

    // Risk assessment
    const riskAssessment = await this.riskEngine.assessKeyAccessRisk({
      sessionKeyId,
      userId: context.userId,
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
      timestamp: context.timestamp,
    });

    // Check time window restrictions
    if (sessionKey.permissions.timeWindow) {
      const currentTime = new Date();
      const userTimezone = sessionKey.permissions.timeWindow.timezone;
      const userHour = this.getTimeInTimezone(currentTime, userTimezone);
      
      const { start, end } = sessionKey.permissions.timeWindow;
      if (userHour < start || userHour > end) {
        return { 
          allowed: false, 
          reason: 'Access outside permitted time window', 
          riskLevel: 'medium' 
        };
      }
    }

    // Check cooldown period
    const recentUsage = await this.getRecentUsage(sessionKeyId, 300); // 5 minutes
    if (recentUsage.length > 0 && sessionKey.permissions.cooldownPeriod) {
      const lastUsage = recentUsage[0];
      const timeSinceLastUsage = Date.now() - lastUsage.timestamp.getTime();
      if (timeSinceLastUsage < sessionKey.permissions.cooldownPeriod * 1000) {
        return { 
          allowed: false, 
          reason: 'Cooldown period active', 
          riskLevel: 'low' 
        };
      }
    }

    return {
      allowed: true,
      riskLevel: riskAssessment.level,
      additionalChecks: riskAssessment.additionalChecks,
    };
  }

  async rotateSessionKey(
    sessionKeyId: string, 
    context: SecurityContext
  ): Promise<boolean> {
    const sessionKey = await this.sessionKeyRepository.findOne({
      where: { id: sessionKeyId },
    });

    if (!sessionKey || sessionKey.userId !== context.userId) {
      throw new UnauthorizedException('Unauthorized session key access');
    }

    try {
      // Generate new key pair
      const newKeyPair = await this.kmsKeyManager.generateKeyPair(`${sessionKeyId}-rotated`);
      
      // Update session key
      sessionKey.publicKey = newKeyPair.publicKey;
      sessionKey.updatedAt = new Date();
      await this.sessionKeyRepository.save(sessionKey);

      // Revoke old key in KMS
      await this.kmsKeyManager.revokeKey(sessionKeyId);

      // Audit rotation
      await this.auditService.logKeyRotation({
        userId: context.userId,
        sessionKeyId,
        timestamp: new Date(),
      });

      this.logger.log(`Rotated session key ${sessionKeyId} for user ${context.userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to rotate session key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async revokeSessionKey(
    sessionKeyId: string, 
    context: SecurityContext
  ): Promise<boolean> {
    const sessionKey = await this.sessionKeyRepository.findOne({
      where: { id: sessionKeyId },
    });

    if (!sessionKey || sessionKey.userId !== context.userId) {
      throw new UnauthorizedException('Unauthorized session key access');
    }

    try {
      // Deactivate session key
      sessionKey.isActive = false;
      sessionKey.updatedAt = new Date();
      await this.sessionKeyRepository.save(sessionKey);

      // Revoke key in KMS
      await this.kmsKeyManager.revokeKey(sessionKeyId);

      // Audit revocation
      await this.auditService.logKeyRevocation({
        userId: context.userId,
        sessionKeyId,
        reason: 'User initiated revocation',
        timestamp: new Date(),
      });

      this.logger.log(`Revoked session key ${sessionKeyId} for user ${context.userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to revoke session key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // Threshold operations for high-value transactions
  async initiateThresholdOperation(
    request: ThresholdOperationRequest
  ): Promise<ThresholdOperationResult> {
    const operationId = uuidv4();
    
    // Store threshold operation in secure storage
    await this.auditService.logThresholdOperation({
      operationId,
      type: request.type,
      threshold: request.threshold,
      participants: request.participants,
      expiresAt: request.expiresAt,
      status: 'pending',
      timestamp: new Date(),
    });

    this.logger.log(`Initiated threshold operation ${operationId} of type ${request.type}`);
    
    return {
      operationId,
      status: 'pending',
      currentShares: 0,
      requiredShares: request.threshold,
      expiresAt: request.expiresAt,
    };
  }

  async submitThresholdShare(
    operationId: string, 
    share: string, 
    context: SecurityContext
  ): Promise<boolean> {
    // Implementation for threshold signature submission
    // This would integrate with MPC libraries like Fireblocks, Coinbase Prime, etc.
    this.logger.log(`Submitted share for threshold operation ${operationId}`);
    return true;
  }

  async getThresholdStatus(operationId: string): Promise<any> {
    // Implementation for threshold operation status
    return { operationId, status: 'pending' };
  }

  async getKeyUsageHistory(
    userId: number
  ): Promise<KeyUsageRecord[]> {
    const keyAccessEvents = this.auditService.getKeyUsageHistory(userId);
    
    // Transform KeyAccessEvent[] to KeyUsageRecord[]
    return keyAccessEvents.map(event => ({
      ...event,
      operation: event.eventType || 'unknown',
      riskScore: event.riskScore || 0,
      success: true // Default to true for successful key access events
    }));
  }

  async emergencyRevokeAllUserKeys(
    userId: number, 
    reason: string, 
    context: SecurityContext
  ): Promise<boolean> {
    const sessionKeys = await this.sessionKeyRepository.find({
      where: { userId, isActive: true },
    });

    const revocationResults = await Promise.allSettled(
      sessionKeys.map(async (sessionKey) => {
        try {
          sessionKey.isActive = false;
          await this.sessionKeyRepository.save(sessionKey);
          await this.kmsKeyManager.revokeKey(sessionKey.id);
          
          await this.auditService.logKeyRevocation({
            userId,
            sessionKeyId: sessionKey.id,
            reason: `Emergency revocation: ${reason}`,
            timestamp: new Date(),
          });
          
          return true;
        } catch (error) {
          this.logger.error(`Failed to emergency revoke key ${sessionKey.id}: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      })
    );

    const successCount = revocationResults.filter(r => r.status === 'fulfilled' && r.value).length;
    this.logger.log(`Emergency revoked ${successCount}/${sessionKeys.length} keys for user ${userId}`);
    
    return successCount === sessionKeys.length;
  }

  async validateKeyIntegrity(): Promise<IntegrityCheckResult> {
    const issues = [];
    const allKeys = await this.sessionKeyRepository.find({ where: { isActive: true } });

    for (const key of allKeys) {
      try {
        // Verify key exists in KMS
        const kmsKeyExists = await this.kmsKeyManager.keyExists(key.id);
        if (!kmsKeyExists) {
          issues.push({
            type: 'missing_key' as const,
            severity: 'high' as const,
            description: `Key ${key.id} exists in database but not in KMS`,
            detectedAt: new Date(),
            affectedEvents: [],
            affectedKeys: [key.id],
          });
        }
      } catch (error) {
        issues.push({
          type: 'corrupted_data' as const,
          severity: 'medium' as const,
          description: `Failed to validate key ${key.id}: ${error instanceof Error ? error.message : String(error)}`,
          detectedAt: new Date(),
          affectedEvents: [],
          affectedKeys: [key.id],
        });
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
      lastChecked: new Date(),
    };
  }

  private async getRecentUsage(sessionKeyId: string, seconds: number): Promise<any[]> {
    // Implementation to get recent key usage from audit logs
    return [];
  }

  private getTimeInTimezone(date: Date, timezone: string): string {
    // Implementation to get time in specific timezone
    return date.getUTCHours().toString().padStart(2, '0');
  }
}
