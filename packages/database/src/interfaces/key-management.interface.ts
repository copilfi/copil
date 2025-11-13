/**
 * Key Management Interface - Clean Code: Dependency Inversion Principle
 * Abstracts key management operations for cross-package usage
 */
export interface IKeyManagementService {
  /**
   * Retrieves private key for session key
   * @param sessionKeyId Session key identifier
   * @returns Private key or null if not found
   */
  getPrivateKey(sessionKeyId: string): Promise<string | null>;

  /**
   * Retrieves session key object
   * @param sessionKeyId Session key identifier
   * @returns Session key object or null if not found
   */
  getSessionKey(sessionKeyId: string): Promise<any>;

  /**
   * Retrieves session key as bytes for Solana
   * @param sessionKeyId Session key identifier
   * @returns Session key bytes or null if not found
   */
  getSessionKeyBytes(sessionKeyId: string): Promise<Uint8Array | null>;

  /**
   * Validates session key permissions
   * @param sessionKeyId Session key identifier  
   * @returns Validation result
   */
  validatePermissions(sessionKeyId: string): Promise<boolean>;

  /**
   * Checks if session key is active
   * @param sessionKeyId Session key identifier
   * @returns Active status
   */
  isSessionKeyActive(sessionKeyId: string): Promise<boolean>;
}
