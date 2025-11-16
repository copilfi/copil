/**
 * MPC Wallet Interface for Institutional Custody
 * Implements threshold signatures, hot/cold separation, and compliance
 */
import { SecurityContext } from '../types/common.types';

// Missing interface stubs
export interface WalletFilters {
  status?: string;
  chains?: string[];
  limit?: number;
  offset?: number;
}

export interface PendingOperation {
  operationId: string;
  type: string;
  status: string;
  createdAt: Date;
}

export interface RiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  factors: string[];
}

export interface MPCWalletInfo {
  id: string;
  userId: number;
  name: string;
  status: 'active' | 'frozen' | 'rotating' | 'recovering';
  address?: string;
  publicKey: string;
  threshold: number;
  totalParticipants: number;
  chains: string[];
  participants: MPCParticipant[];
  hotColdThresholds: HotColdThresholds;
  complianceSettings: ComplianceSettings;
  recoverySettings: RecoverySettings;
  createdAt: Date;
  updatedAt: Date;
  lastActivity?: Date;
  pendingOperations: PendingOperation[];
  riskAssessment?: RiskAssessment;
  chain: string;
  hotColdBalance: HotColdBalance;
  lastKeyRotation?: Date;
}

export interface IMPCWalletService {
  // === Wallet Management ===
  createMPCWallet(config: MPCWalletConfig): Promise<MPCWallet>;
  getWalletInfo(walletId: string): Promise<MPCWalletInfo>;
  listWallets(userId: number, filters?: WalletFilters): Promise<MPCWallet[]>;
  
  // === Key Operations ===
  initiateKeyRotation(walletId: string, reason: string): Promise<KeyRotationOperation>;
  completeKeyRotation(operationId: string, shares: KeyShare[]): Promise<boolean>;
  refreshKeyShares(walletId: string): Promise<boolean>;
  
  // === Transaction Operations ===
  initiateTransaction(request: TransactionRequest): Promise<TransactionOperation>;
  submitTransactionShare(operationId: string, share: PartialSignature): Promise<TransactionStatus>;
  getTransactionStatus(operationId: string): Promise<TransactionStatus>;
  
  // === Hot/Cold Management ===
  getHotColdBalance(): Promise<HotColdBalance>;
  rebalanceHotCold(targetHotAmount: bigint, reason: string): Promise<RebalanceOperation>;
  updateHotColdThresholds(thresholds: HotColdThresholds): Promise<boolean>;
  
  // === Compliance & Security ===
  validateTransactionCompliance(tx: TransactionRequest): Promise<ComplianceResult>;
  setWithdrawalLimits(walletId: string, limits: WithdrawalLimits): Promise<boolean>;
  addWhitelistedAddress(walletId: string, address: string, cooldownPeriod?: number): Promise<boolean>;
  
  // === Emergency Operations ===
  initiateEmergencyRecovery(walletId: string, reason: string): Promise<EmergencyRecoveryOperation>;
  freezeWallet(walletId: string, reason: string, duration: number): Promise<boolean>;
  unfreezeWallet(walletId: string, context: SecurityContext): Promise<boolean>;
}

export interface MPCWalletConfig {
  userId: number;
  name: string;
  threshold: number; // m in m-of-n
  totalParticipants: number; // n in m-of-n
  chains: string[];
  participants: MPCParticipant[];
  hotColdThresholds: HotColdThresholds;
  complianceSettings: ComplianceSettings;
  recoverySettings: RecoverySettings;
}

export interface MPCParticipant {
  id: string;
  name: string;
  role: 'operator' | 'compliance' | 'executive' | 'technical';
  jurisdiction: string;
  endpoint?: string;
  encryptionPublicKey: string;
  isActive: boolean;
}

export interface HotColdThresholds {
  hotWalletMax: bigint; // Maximum amount in hot wallet
  autoRebalanceThreshold: number; // Percentage to trigger rebalance
  minColdReserve: bigint; // Minimum to keep in cold
  dynamicAdjustment: boolean;
  volatilityMultiplier: number;
}

export interface ComplianceSettings {
  requireScreening: boolean;
  screeningProvider: 'chainalysis' | 'trm' | 'elliptic';
  maxDailyVolume: bigint;
  maxSingleTransaction: bigint;
  requireGeolocation: boolean;
  allowedJurisdictions: string[];
  blacklistedAddresses: string[];
}

export interface RecoverySettings {
  recoveryThreshold: number; // Lower threshold for emergency recovery
  recoveryParticipants: string[];
  timelockPeriod: number; // hours
  deadManSwitch: boolean;
  backupLocations: string[];
}

export interface MPCWallet {
  id: string;
  userId: number;
  name: string;
  address?: string; // Generated wallet address (optional during creation)
  chain: string;
  threshold: number;
  totalParticipants: number;
  participants: MPCParticipant[];
  status: 'active' | 'frozen' | 'recovering' | 'deactivated' | 'rotating';
  hotColdBalance: HotColdBalance;
  complianceSettings: ComplianceSettings;
  createdAt: Date;
  updatedAt: Date;
  lastKeyRotation?: Date;
}

export interface KeyShareInfo {
  participantId: string;
  shareId: string;
  publicKey: string;
  lastUsed: Date;
  isActive: boolean;
  backupStatus: 'backed_up' | 'pending' | 'failed';
}

export interface HotColdBalance {
  hotBalance: bigint;
  coldBalance: bigint;
  totalBalance: bigint;
  hotPercentage: number;
  lastRebalance: Date;
  nextRebalanceScheduled?: Date;
}

export interface TransactionRequest {
  walletId: string;
  to: string;
  value: bigint;
  data?: string;
  chain: string;
  gasLimit?: bigint;
  gasPrice?: bigint;
  nonce?: number;
  metadata?: TransactionMetadata;
}

export interface TransactionMetadata {
  userId: number;
  sessionId?: string;
  sourceIp: string;
  userAgent: string;
  riskScore: number;
  complianceChecked: boolean;
  requiresMFA: boolean;
  mfaVerified?: boolean;
  whitelistedDestination: boolean;
  timelockActive: boolean;
  timelockExpires?: Date;
}

export interface TransactionOperation {
  operationId: string;
  walletId: string;
  transaction: TransactionRequest;
  status: 'pending' | 'collecting_shares' | 'ready_to_sign' | 'signed' | 'submitted' | 'confirmed' | 'failed';
  requiredShares: number;
  collectedShares: PartialSignature[];
  createdAt: Date;
  expiresAt: Date;
  complianceResult?: ComplianceResult;
  riskAssessment?: RiskAssessment;
}

export interface PartialSignature {
  participantId: string;
  shareId: string;
  signature: string;
  timestamp: Date;
  publicKey: string;
}

export interface TransactionStatus {
  operationId: string;
  status: TransactionOperation['status'];
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  error?: string;
  timestamp: Date;
}

export interface KeyRotationOperation {
  operationId: string;
  walletId: string;
  type: 'proactive' | 'reactive' | 'emergency';
  reason: string;
  status: 'initiated' | 'collecting_shares' | 'generating_new_keys' | 'updating_shares' | 'completed' | 'failed';
  progress: number; // 0-100
  initiatedAt: Date;
  estimatedCompletion?: Date;
  participantsCompleted: string[];
  newPublicKey?: string;
  backupStatus: BackupStatus[];
}

export interface KeyShare {
  participantId: string;
  shareId: string;
  encryptedShare: string;
  publicKey: string;
  checksum: string;
  version: number;
}

export interface BackupStatus {
  location: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: Date;
  verificationHash?: string;
}

export interface RebalanceOperation {
  operationId: string;
  type: 'hot_to_cold' | 'cold_to_hot';
  amount: bigint;
  reason: string;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed';
  initiatedAt: Date;
  completedAt?: Date;
  transactionHash?: string;
}

export interface ComplianceResult {
  approved: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: ComplianceFlag[];
  screeningResult?: ScreeningResult;
  recommendation: 'approve' | 'manual_review' | 'reject';
  reviewedBy?: string;
  reviewedAt?: Date;
}

export interface ComplianceFlag {
  type: 'sanctions' | 'high_risk_jurisdiction' | 'unusual_volume' | 'new_address' | 'mixer' | 'suspicious_pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  data?: Record<string, any>;
}

export interface ScreeningResult {
  provider: string;
  riskScore: number;
  categories: string[];
  addresses: ScreenedAddress[];
  timestamp: Date;
}

export interface ScreenedAddress {
  address: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
  category?: string;
}

export interface WithdrawalLimits {
  perTransaction: bigint;
  dailyVolume: bigint;
  weeklyVolume: bigint;
  monthlyVolume: bigint;
  velocityChecks: VelocityCheck[];
}

export interface VelocityCheck {
  timeWindow: number; // seconds
  maxTransactions: number;
  maxAmount: bigint;
  cooldownPeriod: number; // seconds
}

export interface EmergencyRecoveryOperation {
  operationId: string;
  walletId: string;
  triggerType: 'dead_man_switch' | 'authorized_recovery' | 'court_order';
  reason: string;
  status: 'initiated' | 'awaiting_shares' | 'completed' | 'failed';
  initiatedAt: Date;
  completedAt?: Date;
  requiredShares: number;
  collectedShares: number;
  shares: PartialSignature[];
}
