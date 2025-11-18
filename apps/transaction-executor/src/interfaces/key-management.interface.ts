import { SessionKeyPermissions } from '@copil/database';

// Key Management Interface for Enterprise Security
export interface SessionKeyResult {
  sessionKeyId: string;
  address: string;
  permissions: SessionKeyPermissions;
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}

export interface KeyAccessEvent {
  userId: number;
  sessionKeyId: string;
  eventType: string;
  timestamp: Date;
  riskScore: number;
  riskLevel: string;
  success: boolean;
  error?: string;
  sourceIp?: string;
  userAgent?: string;
}

export interface IntegrityCheckResult {
  isValid: boolean;
  issues: string[];
  lastChecked: Date;
}

export interface KeyUsageRecord {
  userId: number;
  sessionKeyId: string;
  operation: string;
  timestamp: Date;
  riskScore: number;
  success: boolean;
}

// Main Key Management Service Interface
export interface IKeyManagementService {
  // Core key operations
  generateSessionKey(userId: number, permissions: SessionKeyPermissions): Promise<SessionKeyResult>;
  getPrivateKey(sessionKeyId: string): Promise<string | null>;
  getSessionKey(sessionKeyId: string): Promise<SessionKeyResult | null>;
  getSessionKeyBytes(sessionKeyId: string): Promise<Buffer | null>;

  // Permission and validation
  validatePermissions(
    sessionKeyId: string,
    requiredPermissions: SessionKeyPermissions,
  ): Promise<boolean>;
  isSessionKeyActive(sessionKeyId: string): Promise<boolean>;

  // Enterprise security features
  getKeyUsageHistory(userId: number): Promise<KeyUsageRecord[]>;
  performIntegrityCheck(sessionKeyId: string): Promise<IntegrityCheckResult>;

  // Key lifecycle management
  revokeKey(sessionKeyId: string): Promise<boolean>;
  rotateKey(sessionKeyId: string): Promise<SessionKeyResult>;
  keyExists(sessionKeyId: string): Promise<boolean>;
}
