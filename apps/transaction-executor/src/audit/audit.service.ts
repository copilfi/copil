import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { KeyUsageRecord } from '@copil/database';

export interface WalletCreationEvent {
  userId: number;
  walletId: string;
  walletType?: string;
  timestamp: Date;
  participantCount?: number;
  threshold?: number;
  metadata?: any;
}

export interface TransactionInitiationEvent {
  userId: number;
  transactionId?: string;
  operationId?: string;
  walletId?: string;
  destination?: string;
  riskLevel?: string;
  transactionType?: string;
  amount: string;
  timestamp: Date;
  metadata?: any;
}

export interface KeyRotationEvent {
  walletId?: string;
  operationId?: string;
  reason?: string;
  initiatedBy?: string;
  timestamp: Date;
  userId?: number;
  sessionKeyId?: string;
}

export interface ThresholdOperationEvent {
  operationId: string;
  walletId?: string;
  operationType?: string;
  initiatedBy?: string;
  timestamp: Date;
  type?: string;
  threshold?: number;
  participants?: any[];
  expiresAt?: Date;
  customFilters?: any;
  status?: string;
}

export interface KeyRevocationEvent {
  keyId?: string;
  userId: number;
  reason: string;
  revokedBy?: string;
  timestamp: Date;
  sessionKeyId?: string;
}

export interface KeyAccessEvent {
  sessionKeyId: string;
  userId: number;
  sourceIp?: string;
  userAgent?: string;
  timestamp: Date;
  eventType?: string;
  riskScore?: number;
  riskLevel?: string;
  success?: boolean;
  error?: string;
  metadata?: any;
}

export interface KeyGenerationEvent {
  sessionKeyId: string;
  userId: number;
  timestamp: Date;
  publicKey?: string;
  algorithm?: string;
  permissions?: any;
}

// Database entity for audit logs
@Entity()
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column()
  eventType!: string;

  @Column('json')
  eventData!: any;

  @Column({ nullable: true })
  sessionKeyId?: string;

  @Column({ nullable: true })
  riskScore?: number;

  @Column({ nullable: true })
  riskLevel?: string;

  @Column({ default: true })
  success!: boolean;

  @Column({ nullable: true })
  error?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ nullable: true })
  sourceIp?: string;

  @Column({ nullable: true })
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async logWalletCreation(event: WalletCreationEvent): Promise<void> {
    this.logger.log(`Wallet creation audit: ${JSON.stringify(event)}`);

    try {
      const auditLog = this.auditLogRepository.create({
        userId: event.userId,
        eventType: 'wallet_creation',
        eventData: event,
        riskScore: 0,
        riskLevel: 'low',
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to log wallet creation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async logTransactionInitiation(event: TransactionInitiationEvent): Promise<void> {
    this.logger.log(`Transaction initiation audit: ${JSON.stringify(event)}`);

    try {
      const auditLog = this.auditLogRepository.create({
        userId: event.userId,
        eventType: 'transaction_initiation',
        eventData: event,
        riskLevel: event.riskLevel,
        sourceIp: event.metadata?.sourceIp,
        userAgent: event.metadata?.userAgent,
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to log transaction initiation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async logKeyRotation(event: KeyRotationEvent): Promise<void> {
    this.logger.log(`Key rotation audit: ${JSON.stringify(event)}`);

    try {
      const auditLog = this.auditLogRepository.create({
        userId: event.userId,
        eventType: 'key_rotation',
        eventData: event,
        sessionKeyId: event.sessionKeyId,
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to log key rotation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async logKeyRevocation(event: KeyRevocationEvent): Promise<void> {
    this.logger.log(`Key revocation audit: ${JSON.stringify(event)}`);

    try {
      const auditLog = this.auditLogRepository.create({
        userId: event.userId,
        eventType: 'key_revocation',
        eventData: event,
        sessionKeyId: event.sessionKeyId,
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to log key revocation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async logThresholdOperation(event: ThresholdOperationEvent): Promise<void> {
    this.logger.log(`Threshold operation audit: ${JSON.stringify(event)}`);

    try {
      const auditLog = this.auditLogRepository.create({
        userId: parseInt(event.initiatedBy || '0'),
        eventType: 'threshold_operation',
        eventData: event,
        riskScore: 50, // Medium risk by default for threshold operations
        riskLevel: 'medium',
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to log threshold operation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getKeyUsageHistory(userId: number): Promise<KeyUsageRecord[]> {
    try {
      // Since KeyUsageRecord is not an entity, we'll query AuditLog and transform
      const auditLogs = await this.auditLogRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 100,
      });

      // Transform AuditLog to KeyUsageRecord interface
      return auditLogs.map((log) => ({
        timestamp: log.createdAt,
        operation: log.eventType,
        userId: log.userId,
        sessionKeyId: log.sessionKeyId || '',
        riskScore: log.riskScore || 0,
        success: log.success,
        details: log.eventData,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get key usage history for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async logKeyAccess(event: KeyAccessEvent): Promise<void> {
    this.logger.log(`Key access audit: ${JSON.stringify(event)}`);

    try {
      const auditLog = this.auditLogRepository.create({
        userId: event.userId,
        eventType: 'key_access',
        eventData: event,
        sessionKeyId: event.sessionKeyId,
        riskScore: event.riskScore,
        riskLevel: event.riskLevel,
        success: event.success ?? true,
        error: event.error,
        sourceIp: event.sourceIp,
        userAgent: event.userAgent,
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to log key access: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async logKeyGeneration(event: KeyGenerationEvent): Promise<void> {
    this.logger.log(`Key generation audit: ${JSON.stringify(event)}`);

    try {
      const auditLog = this.auditLogRepository.create({
        userId: event.userId,
        eventType: 'key_generation',
        eventData: event,
        sessionKeyId: event.sessionKeyId,
        riskScore: 0,
        riskLevel: 'low',
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to log key generation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // === Query Methods for Security Analysis ===

  async getRecentSecurityEvents(userId: number, hours: number = 24): Promise<AuditLog[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    try {
      return await this.auditLogRepository.find({
        where: {
          userId,
          createdAt: cutoff,
        },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get recent security events: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getHighRiskEvents(hours: number = 24): Promise<AuditLog[]> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    try {
      return await this.auditLogRepository.find({
        where: {
          createdAt: cutoff,
          riskLevel: In(['high', 'critical']),
        },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get high risk events: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getFailedKeyAccessAttempts(userId: number, hours: number = 24): Promise<number> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    try {
      return await this.auditLogRepository.count({
        where: {
          userId,
          eventType: 'key_access',
          success: false,
          createdAt: cutoff,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to count failed key access attempts: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
