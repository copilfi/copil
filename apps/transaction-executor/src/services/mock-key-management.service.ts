import { Injectable } from '@nestjs/common';
import type { IKeyManagementService } from '@copil/database';

/**
 * Mock Key Management Service - Clean Code: Adapter Pattern
 * Provides temporary implementation for transaction-executor
 * TODO: Implement proper key management or move to shared package
 */
@Injectable()
export class MockKeyManagementService implements IKeyManagementService {
  /**
   * Mock implementation - returns null for now
   * In production, this should integrate with secure key storage
   */
  getPrivateKey(sessionKeyId: string): Promise<string | null> {
    // TODO: Implement secure private key retrieval
    console.warn(`MockKeyManagementService: getPrivateKey called for ${sessionKeyId}`);
    return Promise.resolve(null);
  }

  /**
   * Mock implementation - returns null for now
   * In production, this should retrieve from database
   */
  getSessionKey(sessionKeyId: string): Promise<any> {
    // TODO: Implement session key retrieval
    console.warn(`MockKeyManagementService: getSessionKey called for ${sessionKeyId}`);
    return Promise.resolve(null);
  }

  /**
   * Mock implementation - returns null for now
   * In production, this should convert private key to bytes
   */
  getSessionKeyBytes(sessionKeyId: string): Promise<Uint8Array | null> {
    // TODO: Implement session key bytes conversion
    console.warn(`MockKeyManagementService: getSessionKeyBytes called for ${sessionKeyId}`);
    return Promise.resolve(null);
  }

  /**
   * Mock implementation - returns true for now
   * In production, this should validate against session key permissions
   */
  validatePermissions(sessionKeyId: string): Promise<boolean> {
    // TODO: Implement proper permission validation
    console.warn(`MockKeyManagementService: validatePermissions called for ${sessionKeyId}`);
    return Promise.resolve(true);
  }

  /**
   * Mock implementation - returns true for now
   * In production, this should check session key status
   */
  isSessionKeyActive(sessionKeyId: string): Promise<boolean> {
    // TODO: Implement proper session key status check
    console.warn(`MockKeyManagementService: isSessionKeyActive called for ${sessionKeyId}`);
    return Promise.resolve(true);
  }
}
