import { Injectable, Logger } from '@nestjs/common';
import {
  IKeyManagementService,
  SessionKeyResult,
  KeyAccessEvent,
  IntegrityCheckResult,
  KeyUsageRecord,
} from '../interfaces/key-management.interface';
import { SessionKeyPermissions, SessionActionType } from '@copil/database';

/**
 * Mock Key Management Service - Clean Code: Adapter Pattern
 * Used for development and testing when enterprise security is disabled
 */
@Injectable()
export class MockKeyManagementService implements IKeyManagementService {
  private readonly logger = new Logger(MockKeyManagementService.name);

  /**
   * Mock implementation - returns null for now
   */
  async getPrivateKey(sessionKeyId: string): Promise<string | null> {
    console.warn(`MockKeyManagementService: getPrivateKey called for ${sessionKeyId}`);
    return null;
  }

  /**
   * Mock implementation - returns null for now
   */
  async getSessionKey(sessionKeyId: string): Promise<SessionKeyResult | null> {
    console.warn(`MockKeyManagementService: getSessionKey called for ${sessionKeyId}`);
    return null;
  }

  /**
   * Mock implementation - returns null for now
   */
  async getSessionKeyBytes(sessionKeyId: string): Promise<Buffer | null> {
    console.warn(`MockKeyManagementService: getSessionKeyBytes called for ${sessionKeyId}`);
    return null;
  }

  /**
   * Mock implementation - returns true for now
   */
  async validatePermissions(
    sessionKeyId: string,
    requiredPermissions: SessionKeyPermissions,
  ): Promise<boolean> {
    console.warn(`MockKeyManagementService: validatePermissions called for ${sessionKeyId}`);
    return true;
  }

  /**
   * Mock implementation - returns true for now
   */
  async isSessionKeyActive(sessionKeyId: string): Promise<boolean> {
    console.warn(`MockKeyManagementService: isSessionKeyActive called for ${sessionKeyId}`);
    return true;
  }

  /**
   * Mock implementation for enterprise features
   */
  async generateSessionKey(
    userId: number,
    permissions: SessionKeyPermissions,
  ): Promise<SessionKeyResult> {
    console.warn(`MockKeyManagementService: generateSessionKey called for user ${userId}`);
    return {
      sessionKeyId: `mock-key-${userId}-${Date.now()}`,
      address: '0x' + '0'.repeat(40),
      permissions: {
        actions: ['swap', 'transfer'],
        chains: ['ethereum', 'polygon'],
        allowedContracts: [],
        notes: 'Mock permissions for development',
      },
      createdAt: new Date(),
      isActive: true,
    };
  }

  /**
   * Mock implementation for enterprise features
   */
  async getKeyUsageHistory(userId: number): Promise<KeyUsageRecord[]> {
    console.warn(`MockKeyManagementService: getKeyUsageHistory called for user ${userId}`);
    return [];
  }

  /**
   * Mock implementation for enterprise features
   */
  async performIntegrityCheck(sessionKeyId: string): Promise<IntegrityCheckResult> {
    console.warn(`MockKeyManagementService: performIntegrityCheck called for ${sessionKeyId}`);
    return {
      isValid: true,
      issues: [],
      lastChecked: new Date(),
    };
  }

  /**
   * Mock implementation for enterprise features
   */
  async revokeKey(sessionKeyId: string): Promise<boolean> {
    console.warn(`MockKeyManagementService: revokeKey called for ${sessionKeyId}`);
    return true;
  }

  /**
   * Mock implementation for enterprise features
   */
  async rotateKey(sessionKeyId: string): Promise<SessionKeyResult> {
    console.warn(`MockKeyManagementService: rotateKey called for ${sessionKeyId}`);
    return {
      sessionKeyId: `rotated-${sessionKeyId}`,
      address: '0x' + '0'.repeat(40),
      permissions: {
        actions: ['swap'] as SessionActionType[],
        chains: ['ethereum'],
        allowedContracts: [],
        notes: 'Rotated mock permissions',
      },
      createdAt: new Date(),
      isActive: true,
    };
  }

  /**
   * Mock implementation for enterprise features
   */
  async keyExists(sessionKeyId: string): Promise<boolean> {
    console.warn(`MockKeyManagementService: keyExists called for ${sessionKeyId}`);
    return false;
  }
}
