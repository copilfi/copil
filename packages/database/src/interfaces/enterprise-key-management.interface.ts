/**
 * Enterprise Key Management Interface - Production Ready
 * Implements defense-in-depth with HSM/KMS integration
 */
import { SecurityContext, TimeRange, TimeWindow, IntegrityIssue } from '../types/common.types';
import { SessionKeyPermissions } from '../types/session-key-permissions';

export interface IEnterpriseKeyManagementService {
  // === Core Key Operations ===
  generateSessionKey(userId: number, permissions: SessionKeyPermissions): Promise<SessionKeyResult>;
  getPrivateKey(sessionKeyId: string, context: SecurityContext): Promise<string | null>;
  rotateSessionKey(sessionKeyId: string, context: SecurityContext): Promise<boolean>;
  revokeSessionKey(sessionKeyId: string, context: SecurityContext): Promise<boolean>;
  
  // === MPC/Threshold Operations ===
  initiateThresholdOperation(operation: ThresholdOperationRequest): Promise<ThresholdOperationResult>;
  submitThresholdShare(operationId: string, share: string, context: SecurityContext): Promise<boolean>;
  getThresholdStatus(operationId: string): Promise<ThresholdOperationStatus>;
  
  // === Security & Audit ===
  validateKeyAccess(sessionKeyId: string, context: SecurityContext): Promise<AccessValidationResult>;
  getKeyUsageHistory(userId: number): Promise<KeyUsageRecord[]>;
  
  // === Emergency Operations ===
  emergencyRevokeAllUserKeys(userId: number, reason: string, context: SecurityContext): Promise<boolean>;
  validateKeyIntegrity(): Promise<IntegrityCheckResult>;
}

export interface SessionKeyResult {
  sessionKeyId: string;
  publicKey: string;
  address?: string; // for EVM chains
  expiresAt: Date;
  permissions: SessionKeyPermissions;
}

export interface ThresholdOperationRequest {
  type: 'sign' | 'approve' | 'emergency_revoke';
  threshold: number;
  totalParticipants: number;
  payload: string;
  expiresAt: Date;
  participants: string[];
}

export interface ThresholdOperationResult {
  operationId: string;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  currentShares: number;
  requiredShares: number;
  expiresAt: Date;
}

export interface ThresholdOperationStatus {
  operationId: string;
  status: ThresholdOperationResult['status'];
  participants: string[];
  sharesSubmitted: string[];
  result?: string;
}

export interface AccessValidationResult {
  allowed: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  additionalChecks?: string[];
}

export interface KeyUsageRecord {
  timestamp: Date;
  operation: string;
  userId: number;
  sessionKeyId: string;
  riskScore: number;
  success: boolean;
  details?: Record<string, any>;
}

export interface IntegrityCheckResult {
  healthy: boolean;
  issues: IntegrityIssue[];
  lastChecked: Date;
}
