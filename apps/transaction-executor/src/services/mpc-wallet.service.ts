import { Injectable, Logger, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { 
  IMPCWalletService, 
  MPCWallet, 
  MPCWalletInfo,
  MPCWalletConfig, 
  TransactionRequest, 
  TransactionOperation, 
  TransactionStatus,
  HotColdBalance,
  KeyRotationOperation,
  ComplianceResult,
  WithdrawalLimits,
  SecurityContext,
  MPCParticipant,
  HotColdThresholds,
  ComplianceSettings,
  RecoverySettings,
  PartialSignature,
  RebalanceOperation,
  EmergencyRecoveryOperation
} from '@copil/database';
import { User, TransactionLog } from '@copil/database';
import { MPCClient } from '../mpc/mpc-client';
import { ComplianceEngine } from '../compliance/compliance.engine';
import { RiskEngine } from '../risk/risk.engine';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { ThresholdSignatureService } from '../cryptography/threshold-signature.service';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import * as crypto from 'crypto';

@Injectable()
export class MPCWalletService implements IMPCWalletService {
  private readonly logger = new Logger(MPCWalletService.name);
  private readonly mpcClient: MPCClient;
  private readonly complianceEngine: ComplianceEngine;
  private readonly riskEngine: RiskEngine;
  private readonly thresholdSignature: ThresholdSignatureService;

  // Configuration
  private readonly defaultHotColdThresholds: HotColdThresholds;
  private readonly maxKeyRotationDays: number;
  private readonly emergencyRecoveryThreshold: number;
  private readonly complianceProviders: string[];

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
    private readonly auditService: AuditService,
    private readonly notificationService: NotificationService,
  ) {
    this.mpcClient = new MPCClient(configService);
    this.complianceEngine = new ComplianceEngine(configService);
    this.riskEngine = new RiskEngine(configService);
    this.thresholdSignature = new ThresholdSignatureService(configService);

    // Load configuration
    this.defaultHotColdThresholds = {
      hotWalletMax: BigInt(this.configService.get<string>('DEFAULT_HOT_WALLET_MAX', '25000')), // $25k default
      autoRebalanceThreshold: 0.8, // 80%
      minColdReserve: BigInt(this.configService.get<string>('MIN_COLD_RESERVE', '100000')), // $100k
      dynamicAdjustment: true,
      volatilityMultiplier: 2.0,
    };

    this.maxKeyRotationDays = this.configService.get<number>('MAX_KEY_ROTATION_DAYS', 90);
    this.emergencyRecoveryThreshold = this.configService.get<number>('EMERGENCY_RECOVERY_THRESHOLD', 2);
    this.complianceProviders = this.configService.get<string[]>('COMPLIANCE_PROVIDERS', ['chainalysis', 'trm']);
  }

  async createMPCWallet(config: MPCWalletConfig): Promise<MPCWallet> {
    const user = await this.userRepository.findOne({ where: { id: config.userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    try {
      // Validate configuration
      this.validateWalletConfig(config);

      // Generate MPC key pair with threshold signature scheme
      const mpcKeyResult = await this.mpcClient.generateThresholdKey(
        config.threshold,
        config.totalParticipants,
        config.participants.map(p => p.id) // Map MPCParticipant[] to string[]
      );

      // Create wallet record
      const wallet: MPCWallet = {
        id: uuidv4(),
        userId: config.userId,
        name: config.name,
        address: mpcKeyResult.address,
        chain: config.chains[0], // Primary chain
        threshold: config.threshold,
        totalParticipants: config.totalParticipants,
        participants: config.participants,
        status: 'active',
        hotColdBalance: {
          hotBalance: BigInt(0),
          coldBalance: BigInt(0),
          totalBalance: BigInt(0),
          hotPercentage: 0,
          lastRebalance: new Date(),
        },
        complianceSettings: config.complianceSettings,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store wallet in secure storage
      await this.storeMPCWallet(wallet);

      // Initialize hot/cold balance
      await this.initializeHotColdBalance(wallet.id);

      // Setup compliance monitoring
      await this.complianceEngine.setupWalletMonitoring(wallet.id, config.complianceSettings);

      // Audit wallet creation
      await this.auditService.logWalletCreation({
        walletId: wallet.id,
        userId: config.userId,
        participantCount: config.totalParticipants,
        threshold: config.threshold,
        timestamp: new Date(),
      });

      // Notify participants
      await this.notificationService.notifyWalletCreation(wallet, config.participants);

      this.logger.log(`Created MPC wallet ${wallet.id} for user ${config.userId} with ${config.totalParticipants}/${config.threshold} scheme`);

      return wallet;
    } catch (error) {
      this.logger.error(`Failed to create MPC wallet: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async initiateTransaction(request: TransactionRequest): Promise<TransactionOperation> {
    try {
      // Get wallet info
      const wallet = await this.getWalletInfo(request.walletId);
      if (wallet.status !== 'active') {
        throw new BadRequestException(`Wallet ${request.walletId} is not active`);
      }

      // Risk assessment
      const riskAssessment = await this.riskEngine.assessTransactionRisk(request, wallet);
      if (riskAssessment.riskLevel === 'critical') {
        throw new BadRequestException('Transaction risk too high');
      }

      // Compliance validation
      const complianceResult = await this.validateTransactionCompliance(request);
      if (!complianceResult.approved) {
        throw new BadRequestException(`Transaction not compliant: ${complianceResult.flags.map(f => f.description).join(', ')}`);
      }

      // Check hot/cold balance
      const hotColdBalance = await this.getHotColdBalance();
      if (request.value > hotColdBalance.hotBalance) {
        // Transaction requires cold wallet funds
        const rebalanceNeeded = request.value - hotColdBalance.hotBalance;
        await this.initiateColdToHotTransfer(request.walletId, rebalanceNeeded);
      }

      // Check withdrawal limits
      await this.validateWithdrawalLimits(request.walletId, request.value, request.metadata?.userId || 0);

      // Check if destination is whitelisted
      if (!await this.isWhitelistedAddress(request.walletId, request.to)) {
        // Apply timelock for new addresses
        const timelockPeriod = this.configService.get<number>('NEW_ADDRESS_TIMELOCK_HOURS', 24);
        if (request.metadata) {
          request.metadata.timelockActive = true;
        }
        if (request.metadata) {
          request.metadata.timelockExpires = new Date(Date.now() + timelockPeriod * 60 * 60 * 1000);
        }
      }

      // Create transaction operation
      const operation: TransactionOperation = {
        operationId: uuidv4(),
        walletId: request.walletId,
        transaction: request,
        status: 'pending',
        requiredShares: wallet.threshold,
        collectedShares: [],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes expiry
        complianceResult,
        riskAssessment,
      };

      // Store operation
      await this.storeTransactionOperation(operation);

      // Initiate MPC signature collection
      const signatureRequest = {
        messageHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(request))),
        shares: [], // Will be populated during signature collection
        threshold: wallet.threshold
      };
      await this.mpcClient.initiateSignatureCollection(signatureRequest);

      // Audit transaction initiation
      await this.auditService.logTransactionInitiation({
        operationId: operation.operationId,
        walletId: request.walletId,
        userId: request.metadata?.userId || 0,
        amount: request.value.toString(),
        destination: request.to,
        riskLevel: riskAssessment.riskLevel,
        timestamp: new Date(),
      });

      this.logger.log(`Initiated transaction ${operation.operationId} for wallet ${request.walletId}`);

      return operation;
    } catch (error) {
      this.logger.error(`Failed to initiate transaction: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async submitTransactionShare(operationId: string, share: PartialSignature): Promise<TransactionStatus> {
    try {
      const operation = await this.getTransactionOperation(operationId);
      if (!operation) {
        throw new NotFoundException('Transaction operation not found');
      }

      if (operation.status !== 'collecting_shares') {
        throw new BadRequestException(`Invalid operation status: ${operation.status}`);
      }

      // Validate share
      const isValidShare = await this.thresholdSignature.validatePartialSignature(share, operation);
      if (!isValidShare) {
        throw new BadRequestException('Invalid partial signature');
      }

      // Add share to operation
      operation.collectedShares.push(share);
      operation.status = operation.collectedShares.length >= operation.requiredShares ? 'ready_to_sign' : 'collecting_shares';

      // Update operation
      await this.updateTransactionOperation(operation);

      // If enough shares collected, generate final signature
      if (operation.status === 'ready_to_sign') {
        const finalSignature = await this.thresholdSignature.combinePartialSignatures(
          operation.collectedShares,
          operation.transaction
        );

        // Submit transaction to blockchain
        const txHash = await this.submitTransactionToChain(operation.transaction, finalSignature);

        operation.status = 'submitted';
        await this.updateTransactionOperation(operation);

        // Create transaction log
        await this.createTransactionLog(operation, txHash);

        return {
          operationId,
          status: 'submitted',
          transactionHash: txHash,
          timestamp: new Date(),
        };
      }

      return {
        operationId,
        status: operation.status,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to submit transaction share: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async initiateKeyRotation(walletId: string, reason: string): Promise<KeyRotationOperation> {
    try {
      const wallet = await this.getWalletInfo(walletId);
      if (wallet.status !== 'active') {
        throw new BadRequestException('Wallet must be active for key rotation');
      }

      // Check if rotation is allowed (rate limiting)
      const lastRotation = wallet.lastKeyRotation;
      if (lastRotation) {
        const daysSinceRotation = (Date.now() - lastRotation.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceRotation < 7) { // Minimum 7 days between rotations
          throw new BadRequestException('Key rotation too frequent');
        }
      }

      // Create key rotation operation
      const operation: KeyRotationOperation = {
        operationId: uuidv4(),
        walletId,
        type: reason.includes('emergency') ? 'emergency' : 'proactive',
        reason,
        status: 'initiated',
        progress: 0,
        initiatedAt: new Date(),
        estimatedCompletion: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
        participantsCompleted: [],
        backupStatus: [],
      };

      // Store operation
      await this.storeKeyRotationOperation(operation);

      // Initiate MPC key refresh (proactive share rotation without changing address)
      await this.mpcClient.initiateKeyRefresh(
        walletId, 
        wallet.participants.map(p => p.id), // Map MPCParticipant[] to string[]
        operation.operationId
      );

      // Audit key rotation
      await this.auditService.logKeyRotation({
        walletId,
        operationId: operation.operationId,
        reason,
        initiatedBy: 'system', // Should be context.userId
        timestamp: new Date(),
      });
      this.logger.log(`Initiated key rotation ${operation.operationId} for wallet ${walletId}`);

      return operation;
    } catch (error) {
      this.logger.error(`Failed to initiate key rotation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getHotColdBalance(): Promise<HotColdBalance> {
    // Implementation would query actual blockchain balances
    // For now, return mock data
    return {
      hotBalance: BigInt(25000),
      coldBalance: BigInt(500000),
      totalBalance: BigInt(525000),
      hotPercentage: 4.76,
      lastRebalance: new Date(),
    };
  }

  async rebalanceHotCold(targetHotAmount: bigint, reason: string): Promise<RebalanceOperation> {
    const currentBalance = await this.getHotColdBalance();
    
    let type: 'hot_to_cold' | 'cold_to_hot';
    let amount: bigint;

    if (targetHotAmount > currentBalance.hotBalance) {
      type = 'cold_to_hot';
      amount = targetHotAmount - currentBalance.hotBalance;
    } else {
      type = 'hot_to_cold';
      amount = currentBalance.hotBalance - targetHotAmount;
    }

    const operation: RebalanceOperation = {
      operationId: uuidv4(),
      type,
      amount,
      reason,
      status: 'pending',
      initiatedAt: new Date(),
    };

    // Execute rebalancing transaction
    // Implementation would create and execute internal transfer transaction

    await this.storeRebalanceOperation(operation);

    this.logger.log(`Initiated ${type} rebalance of ${amount.toString()} for reason: ${reason}`);

    return operation;
  }

  async validateTransactionCompliance(tx: TransactionRequest): Promise<ComplianceResult> {
    try {
      // Multi-provider compliance screening
      const screeningResults = await Promise.all(
        this.complianceProviders.map(provider => 
          this.complianceEngine.screenTransaction(tx, provider)
        )
      );

      // Aggregate results
      const aggregatedResult = await this.complianceEngine.aggregateScreeningResults(screeningResults);

      // Check against wallet-specific rules
      const wallet = await this.getWalletInfo(tx.walletId);
      const ruleValidation = await this.validateAgainstWalletRules(tx, wallet);

      // Combine results
      const finalResult: ComplianceResult = {
        approved: aggregatedResult.approved && ruleValidation.approved,
        riskLevel: this.getHighestRiskLevel(aggregatedResult.riskLevel, ruleValidation.riskLevel),
        flags: [...aggregatedResult.flags, ...ruleValidation.flags],
        screeningResult: aggregatedResult.screeningResult,
        recommendation: aggregatedResult.recommendation === 'reject' || ruleValidation.recommendation === 'reject' 
          ? 'reject' 
          : 'manual_review',
      };

      return finalResult;
    } catch (error) {
      this.logger.error(`Compliance validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        approved: false,
        riskLevel: 'critical',
        flags: [{
          type: 'suspicious_pattern',
          severity: 'critical',
          description: `Compliance system error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        recommendation: 'reject',
      };
    }
  }

  // === Private Helper Methods ===

  private validateWalletConfig(config: MPCWalletConfig): void {
    if (config.threshold >= config.totalParticipants) {
      throw new BadRequestException('Threshold must be less than total participants');
    }

    if (config.threshold < 2) {
      throw new BadRequestException('Threshold must be at least 2 for security');
    }

    if (config.totalParticipants > 10) {
      throw new BadRequestException('Maximum 10 participants allowed');
    }

    if (config.participants.length !== config.totalParticipants) {
      throw new BadRequestException('Participant count mismatch');
    }

    // Validate participant jurisdictions
    const jurisdictions = config.participants.map(p => p.jurisdiction);
    const uniqueJurisdictions = [...new Set(jurisdictions)];
    if (uniqueJurisdictions.length < 2) {
      throw new BadRequestException('Participants must be in at least 2 different jurisdictions');
    }
  }

  private async storeMPCWallet(wallet: MPCWallet): Promise<void> {
    // Implementation to store wallet in secure database
    this.logger.debug(`Storing MPC wallet ${wallet.id}`);
  }

  private async initializeHotColdBalance(walletId: string): Promise<void> {
    // Implementation to initialize hot/cold balance tracking
    this.logger.debug(`Initializing hot/cold balance for wallet ${walletId}`);
  }

  private async storeTransactionOperation(operation: TransactionOperation): Promise<void> {
    // Implementation to store transaction operation
    this.logger.debug(`Storing transaction operation ${operation.operationId}`);
  }

  private async getTransactionOperation(operationId: string): Promise<TransactionOperation | null> {
    // Implementation to retrieve transaction operation
    this.logger.debug(`Retrieving transaction operation ${operationId}`);
    return null; // Placeholder
  }

  private async updateTransactionOperation(operation: TransactionOperation): Promise<void> {
    // Implementation to update transaction operation
    this.logger.debug(`Updating transaction operation ${operation.operationId}`);
  }

  private async submitTransactionToChain(tx: TransactionRequest, signature: string): Promise<string> {
    // Implementation to submit signed transaction to blockchain
    this.logger.debug(`Submitting transaction to chain for wallet ${tx.walletId}`);
    return '0x' + crypto.randomBytes(32).toString('hex'); // Placeholder
  }

  private async createTransactionLog(operation: TransactionOperation, txHash: string): Promise<void> {
    const log = this.transactionLogRepository.create({
      userId: operation.transaction.metadata?.userId || 0,
      description: `MPC transaction to ${operation.transaction.to}`,
      txHash,
      chain: operation.transaction.chain,
      status: 'pending',
      details: {
        operationId: operation.operationId,
        walletId: operation.walletId,
        amount: operation.transaction.value.toString(),
        riskLevel: operation.riskAssessment?.riskLevel,
      },
    });

    await this.transactionLogRepository.save(log);
  }

  private async storeKeyRotationOperation(operation: KeyRotationOperation): Promise<void> {
    // Implementation to store key rotation operation
    this.logger.debug(`Storing key rotation operation ${operation.operationId}`);
  }

  private async storeRebalanceOperation(operation: RebalanceOperation): Promise<void> {
    // Implementation to store rebalance operation
    this.logger.debug(`Storing rebalance operation ${operation.operationId}`);
  }

  private async validateAgainstWalletRules(tx: TransactionRequest, wallet: MPCWallet): Promise<any> {
    // Implementation to validate against wallet-specific rules
    return {
      approved: true,
      riskLevel: 'low',
      flags: [],
      recommendation: 'approve',
    };
  }

  private getHighestRiskLevel(level1: string, level2: string): 'low' | 'medium' | 'high' | 'critical' {
    const levels = { low: 0, medium: 1, high: 2, critical: 3 };
    return (levels[level1 as keyof typeof levels] >= levels[level2 as keyof typeof levels]) 
      ? level1 as any 
      : level2 as any;
  }

  private async isWhitelistedAddress(walletId: string, address: string): Promise<boolean> {
    // Implementation to check if address is whitelisted
    return false; // Placeholder
  }

  private async validateWithdrawalLimits(walletId: string, amount: bigint, userId: number): Promise<void> {
    // Implementation to validate against withdrawal limits
    this.logger.debug(`Validating withdrawal limits for wallet ${walletId}`);
  }

  private async initiateColdToHotTransfer(walletId: string, amount: bigint): Promise<void> {
    // Implementation to initiate transfer from cold to hot wallet
    this.logger.debug(`Initiating cold to hot transfer of ${amount.toString()} for wallet ${walletId}`);
  }

  // === Interface Implementation (remaining methods) ===

  async getWalletInfo(walletId: string): Promise<MPCWalletInfo> {
    // Implementation to get detailed wallet information
    throw new Error('Not implemented');
  }

  async listWallets(userId: number, filters?: any): Promise<MPCWallet[]> {
    // Implementation to list user wallets
    throw new Error('Not implemented');
  }

  async completeKeyRotation(operationId: string, shares: any[]): Promise<boolean> {
    // Implementation to complete key rotation
    throw new Error('Not implemented');
  }

  async refreshKeyShares(walletId: string): Promise<boolean> {
    // Implementation to refresh key shares
    throw new Error('Not implemented');
  }

  async getTransactionStatus(operationId: string): Promise<TransactionStatus> {
    // Implementation to get transaction status
    throw new Error('Not implemented');
  }

  async updateHotColdThresholds(thresholds: HotColdThresholds): Promise<boolean> {
    // Implementation to update hot/cold thresholds
    throw new Error('Not implemented');
  }

  async setWithdrawalLimits(walletId: string, limits: WithdrawalLimits): Promise<boolean> {
    // Implementation to set withdrawal limits
    throw new Error('Not implemented');
  }

  async addWhitelistedAddress(walletId: string, address: string, cooldownPeriod?: number): Promise<boolean> {
    // Implementation to add whitelisted address
    throw new Error('Not implemented');
  }

  async initiateEmergencyRecovery(walletId: string, reason: string): Promise<EmergencyRecoveryOperation> {
    // Implementation to initiate emergency recovery
    throw new Error('Not implemented');
  }

  async freezeWallet(walletId: string, reason: string, duration: number): Promise<boolean> {
    // Implementation to freeze wallet
    throw new Error('Not implemented');
  }

  async unfreezeWallet(walletId: string, context: SecurityContext): Promise<boolean> {
    // Implementation to unfreeze wallet
    throw new Error('Not implemented');
  }
}
