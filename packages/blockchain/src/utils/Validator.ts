/**
 * Input Validation Utilities
 * Clean validation for blockchain operations
 */

import { ethers } from 'ethers';
import { ValidationError } from '../types/errors';

export class Validator {
  /**
   * Validate Ethereum address
   */
  static isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  /**
   * Validate and normalize address
   */
  static validateAddress(address: string, fieldName = 'address'): string {
    if (!address) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }

    if (!this.isValidAddress(address)) {
      throw new ValidationError(`Invalid ${fieldName} format`, fieldName);
    }

    return ethers.getAddress(address); // Returns checksummed address
  }

  /**
   * Validate private key
   */
  static validatePrivateKey(privateKey: string, fieldName = 'privateKey'): string {
    if (!privateKey) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }

    // Add 0x prefix if missing
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    // Validate length and format
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      throw new ValidationError(`Invalid ${fieldName} format`, fieldName);
    }

    return privateKey;
  }

  /**
   * Validate amount (positive number)
   */
  static validateAmount(amount: string | number, fieldName = 'amount'): string {
    if (!amount && amount !== 0) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }

    const amountStr = amount.toString();
    
    // Check if valid number
    if (!/^\d*\.?\d+$/.test(amountStr)) {
      throw new ValidationError(`Invalid ${fieldName} format`, fieldName);
    }

    const numAmount = parseFloat(amountStr);
    if (numAmount < 0) {
      throw new ValidationError(`${fieldName} must be positive`, fieldName);
    }

    return amountStr;
  }

  /**
   * Validate gas limit
   */
  static validateGasLimit(gasLimit: string | number, fieldName = 'gasLimit'): string {
    const gasStr = this.validateAmount(gasLimit, fieldName);
    const gasNum = parseInt(gasStr);
    
    if (gasNum < 21000) {
      throw new ValidationError(`${fieldName} must be at least 21000`, fieldName);
    }
    
    if (gasNum > 30000000) {
      throw new ValidationError(`${fieldName} exceeds maximum limit`, fieldName);
    }

    return gasStr;
  }

  /**
   * Validate hex string
   */
  static validateHexString(hex: string, fieldName = 'hex'): string {
    if (!hex) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }

    if (!hex.startsWith('0x')) {
      hex = '0x' + hex;
    }

    if (!/^0x[a-fA-F0-9]*$/.test(hex)) {
      throw new ValidationError(`Invalid ${fieldName} format`, fieldName);
    }

    return hex;
  }

  /**
   * Validate transaction hash
   */
  static validateTxHash(hash: string, fieldName = 'transactionHash'): string {
    const validatedHex = this.validateHexString(hash, fieldName);
    
    if (validatedHex.length !== 66) { // 0x + 64 chars
      throw new ValidationError(`Invalid ${fieldName} length`, fieldName);
    }

    return validatedHex;
  }

  /**
   * Validate chain ID
   */
  static validateChainId(chainId: number | string, fieldName = 'chainId'): number {
    const id = typeof chainId === 'string' ? parseInt(chainId) : chainId;
    
    if (isNaN(id) || id <= 0) {
      throw new ValidationError(`Invalid ${fieldName}`, fieldName);
    }

    return id;
  }

  /**
   * Validate URL
   */
  static validateUrl(url: string, fieldName = 'url'): string {
    if (!url) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }

    try {
      new URL(url);
      return url;
    } catch {
      throw new ValidationError(`Invalid ${fieldName} format`, fieldName);
    }
  }

  /**
   * Validate array of addresses
   */
  static validateAddressArray(addresses: string[], fieldName = 'addresses'): string[] {
    if (!Array.isArray(addresses)) {
      throw new ValidationError(`${fieldName} must be an array`, fieldName);
    }

    return addresses.map((address, index) => 
      this.validateAddress(address, `${fieldName}[${index}]`)
    );
  }

  /**
   * Validate timestamp
   */
  static validateTimestamp(timestamp: number | string, fieldName = 'timestamp'): number {
    const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
    
    if (isNaN(ts) || ts <= 0) {
      throw new ValidationError(`Invalid ${fieldName}`, fieldName);
    }

    // Check if timestamp is reasonable (not too far in past/future)
    const now = Math.floor(Date.now() / 1000);
    const oneYear = 365 * 24 * 60 * 60;
    
    if (ts < now - oneYear || ts > now + oneYear) {
      throw new ValidationError(`${fieldName} out of reasonable range`, fieldName);
    }

    return ts;
  }

  /**
   * Validate object has required fields
   */
  static validateRequiredFields<T extends Record<string, any>>(
    obj: T, 
    requiredFields: (keyof T)[]
  ): void {
    const missing = requiredFields.filter(field => !(field in obj) || obj[field] == null);
    
    if (missing.length > 0) {
      throw new ValidationError(`Missing required fields: ${missing.join(', ')}`, 'object');
    }
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(str: string, maxLength = 1000): string {
    if (typeof str !== 'string') {
      throw new ValidationError('Input must be a string');
    }

    // Remove null bytes and control characters
    const sanitized = str.replace(/[\x00-\x1F\x7F]/g, '');
    
    if (sanitized.length > maxLength) {
      throw new ValidationError(`String exceeds maximum length of ${maxLength}`);
    }

    return sanitized.trim();
  }

  /**
   * Validate session key config
   */
  static validateSessionKeyConfig(config: {
    sessionKey: string;
    validUntil: number;
    limitAmount: string;
    allowedTargets: string[];
    allowedFunctions: string[];
  }): void {
    this.validateAddress(config.sessionKey, 'sessionKey');
    this.validateTimestamp(config.validUntil, 'validUntil');
    this.validateAmount(config.limitAmount, 'limitAmount');
    this.validateAddressArray(config.allowedTargets, 'allowedTargets');
    
    if (!Array.isArray(config.allowedFunctions)) {
      throw new ValidationError('allowedFunctions must be an array');
    }
  }
}

export default Validator;