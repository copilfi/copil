import { ethers, Wallet, HDNodeWallet } from 'ethers';
import { BlockchainLogger } from '../utils/Logger';

const logger = BlockchainLogger.getInstance();

export interface SessionKeyInfo {
  address: string;
  privateKey: string;
  validUntil: number;
  limitAmount: string;
  spentAmount: string;
  allowedTargets: string[];
  allowedFunctions: string[];
  smartAccountAddress: string;
  isActive: boolean;
  createdAt: number;
}

export interface SessionKeyPermissions {
  validUntil: number; // Unix timestamp
  limitAmount: string; // In ETH
  allowedTargets: string[]; // Contract addresses
  allowedFunctions: string[]; // Function selectors (bytes4)
}

export class SessionKeyWallet {
  private provider: ethers.Provider;
  private sessionKeys: Map<string, SessionKeyInfo> = new Map();
  private masterWallet?: HDNodeWallet;

  constructor(provider: ethers.Provider, mnemonic?: string) {
    this.provider = provider;
    
    if (mnemonic) {
      this.masterWallet = HDNodeWallet.fromMnemonic(
        ethers.Mnemonic.fromPhrase(mnemonic)
      );
    }

    logger.info('SessionKeyWallet initialized');
  }

  /**
   * Generate a new session key
   */
  async generateSessionKey(
    smartAccountAddress: string,
    permissions: SessionKeyPermissions,
    keyIndex?: number
  ): Promise<SessionKeyInfo> {
    try {
      let wallet: Wallet;
      
      if (this.masterWallet && keyIndex !== undefined) {
        const path = `m/44'/60'/0'/0/${keyIndex}`;
        const derived = this.masterWallet.derivePath(path);
        wallet = new Wallet(derived.privateKey, this.provider);
      } else {
        const randomWallet = ethers.Wallet.createRandom();
        wallet = new Wallet(randomWallet.privateKey, this.provider);
      }

      const sessionKeyInfo: SessionKeyInfo = {
        address: wallet.address,
        privateKey: wallet.privateKey,
        validUntil: permissions.validUntil,
        limitAmount: permissions.limitAmount,
        spentAmount: '0',
        allowedTargets: permissions.allowedTargets,
        allowedFunctions: permissions.allowedFunctions,
        smartAccountAddress,
        isActive: false, // Will be activated when registered on Smart Account
        createdAt: Math.floor(Date.now() / 1000)
      };

      // Store session key
      this.sessionKeys.set(wallet.address, sessionKeyInfo);

      logger.info(`Generated session key ${wallet.address} for Smart Account ${smartAccountAddress}`);
      logger.info(`  Valid until: ${new Date(permissions.validUntil * 1000).toISOString()}`);
      logger.info(`  Limit amount: ${permissions.limitAmount} ETH`);
      
      return sessionKeyInfo;
    } catch (error: unknown) {
      logger.error('Failed to generate session key:', error as Error);
      throw error;
    }
  }

  /**
   * Get session key wallet instance
   */
  getSessionKeyWallet(sessionKeyAddress: string): Wallet | null {
    try {
      const sessionKeyInfo = this.sessionKeys.get(sessionKeyAddress);
      if (!sessionKeyInfo) {
        logger.warn(`Session key ${sessionKeyAddress} not found`);
        return null;
      }

      return new Wallet(sessionKeyInfo.privateKey, this.provider);
    } catch (error: unknown) {
      logger.error(`Failed to get session key wallet ${sessionKeyAddress}:`, error as Error);
      return null;
    }
  }

  /**
   * Get session key info
   */
  getSessionKeyInfo(sessionKeyAddress: string): SessionKeyInfo | null {
    return this.sessionKeys.get(sessionKeyAddress) || null;
  }

  /**
   * Update session key status
   */
  updateSessionKeyStatus(sessionKeyAddress: string, isActive: boolean): void {
    const sessionKeyInfo = this.sessionKeys.get(sessionKeyAddress);
    if (sessionKeyInfo) {
      sessionKeyInfo.isActive = isActive;
      this.sessionKeys.set(sessionKeyAddress, sessionKeyInfo);
      logger.info(`Session key ${sessionKeyAddress} status updated to ${isActive ? 'active' : 'inactive'}`);
    }
  }

  /**
   * Update spent amount for session key
   */
  updateSpentAmount(sessionKeyAddress: string, additionalAmount: string): void {
    const sessionKeyInfo = this.sessionKeys.get(sessionKeyAddress);
    if (sessionKeyInfo) {
      const currentSpent = parseFloat(sessionKeyInfo.spentAmount);
      const additional = parseFloat(additionalAmount);
      sessionKeyInfo.spentAmount = (currentSpent + additional).toString();
      
      this.sessionKeys.set(sessionKeyAddress, sessionKeyInfo);
      logger.info(`Session key ${sessionKeyAddress} spent amount updated: ${sessionKeyInfo.spentAmount} ETH`);
    }
  }

  /**
   * Check if session key can spend amount
   */
  canSpend(sessionKeyAddress: string, amount: string): boolean {
    const sessionKeyInfo = this.sessionKeys.get(sessionKeyAddress);
    if (!sessionKeyInfo || !sessionKeyInfo.isActive) {
      return false;
    }

    // Check if expired
    const now = Math.floor(Date.now() / 1000);
    if (now > sessionKeyInfo.validUntil) {
      logger.warn(`Session key ${sessionKeyAddress} has expired`);
      return false;
    }

    // Check spending limit
    const currentSpent = parseFloat(sessionKeyInfo.spentAmount);
    const requestedAmount = parseFloat(amount);
    const limit = parseFloat(sessionKeyInfo.limitAmount);

    if (currentSpent + requestedAmount > limit) {
      logger.warn(`Session key ${sessionKeyAddress} spending limit exceeded`);
      logger.warn(`  Current spent: ${currentSpent} ETH`);
      logger.warn(`  Requested: ${requestedAmount} ETH`);
      logger.warn(`  Limit: ${limit} ETH`);
      return false;
    }

    return true;
  }

  /**
   * Check if session key can call target function
   */
  canCallFunction(sessionKeyAddress: string, target: string, functionSelector: string): boolean {
    const sessionKeyInfo = this.sessionKeys.get(sessionKeyAddress);
    if (!sessionKeyInfo || !sessionKeyInfo.isActive) {
      return false;
    }

    // Check if target is allowed
    if (sessionKeyInfo.allowedTargets.length > 0) {
      const isTargetAllowed = sessionKeyInfo.allowedTargets.some(
        allowedTarget => allowedTarget.toLowerCase() === target.toLowerCase()
      );
      
      if (!isTargetAllowed) {
        logger.warn(`Session key ${sessionKeyAddress} not allowed to call target ${target}`);
        return false;
      }
    }

    // Check if function is allowed
    if (sessionKeyInfo.allowedFunctions.length > 0) {
      const isFunctionAllowed = sessionKeyInfo.allowedFunctions.some(
        allowedFunction => allowedFunction.toLowerCase() === functionSelector.toLowerCase()
      );
      
      if (!isFunctionAllowed) {
        logger.warn(`Session key ${sessionKeyAddress} not allowed to call function ${functionSelector}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Get all session keys for Smart Account
   */
  getSessionKeysForSmartAccount(smartAccountAddress: string): SessionKeyInfo[] {
    const keys: SessionKeyInfo[] = [];
    
    for (const [address, info] of this.sessionKeys.entries()) {
      if (info.smartAccountAddress.toLowerCase() === smartAccountAddress.toLowerCase()) {
        keys.push(info);
      }
    }

    return keys.sort((a, b) => b.createdAt - a.createdAt); // Most recent first
  }

  /**
   * Get active session keys for Smart Account
   */
  getActiveSessionKeysForSmartAccount(smartAccountAddress: string): SessionKeyInfo[] {
    const now = Math.floor(Date.now() / 1000);
    
    return this.getSessionKeysForSmartAccount(smartAccountAddress).filter(info => 
      info.isActive && info.validUntil > now
    );
  }

  /**
   * Revoke session key locally
   */
  revokeSessionKey(sessionKeyAddress: string): void {
    const sessionKeyInfo = this.sessionKeys.get(sessionKeyAddress);
    if (sessionKeyInfo) {
      sessionKeyInfo.isActive = false;
      this.sessionKeys.set(sessionKeyAddress, sessionKeyInfo);
      logger.info(`Session key ${sessionKeyAddress} revoked locally`);
    }
  }

  /**
   * Clean up expired session keys
   */
  cleanupExpiredKeys(): number {
    const now = Math.floor(Date.now() / 1000);
    let cleanedCount = 0;
    
    for (const [address, info] of this.sessionKeys.entries()) {
      if (info.validUntil < now) {
        this.sessionKeys.delete(address);
        cleanedCount++;
        logger.info(`Cleaned up expired session key ${address}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired session keys`);
    }

    return cleanedCount;
  }

  /**
   * Export session key data (for persistence)
   */
  exportSessionKeys(): Record<string, SessionKeyInfo> {
    const exported: Record<string, SessionKeyInfo> = {};
    
    for (const [address, info] of this.sessionKeys.entries()) {
      exported[address] = { ...info };
    }

    return exported;
  }

  /**
   * Import session key data (from persistence)
   */
  importSessionKeys(sessionKeysData: Record<string, SessionKeyInfo>): void {
    for (const [address, info] of Object.entries(sessionKeysData)) {
      this.sessionKeys.set(address, info);
    }
    
    logger.info(`Imported ${Object.keys(sessionKeysData).length} session keys`);
  }

  /**
   * Create session key for automated trading
   */
  async createAutomatedTradingKey(
    smartAccountAddress: string,
    validityHours: number = 24,
    limitAmountEth: string = '1.0',
    tradingContractAddresses: string[] = []
  ): Promise<SessionKeyInfo> {
    const validUntil = Math.floor(Date.now() / 1000) + (validityHours * 3600);
    
    // Common trading function selectors
    const tradingFunctionSelectors = [
      '0xa9059cbb', // transfer(address,uint256)
      '0x095ea7b3', // approve(address,uint256)
      '0x7ff36ab5', // swapExactETHForTokens
      '0x38ed1739', // swapExactTokensForTokens
      '0x8803dbee', // swapTokensForExactTokens
      '0x02751cec', // removeLiquidity
      '0xf305d719', // addLiquidityETH
      '0xe8e33700', // addLiquidity
    ];

    const permissions: SessionKeyPermissions = {
      validUntil,
      limitAmount: limitAmountEth,
      allowedTargets: tradingContractAddresses,
      allowedFunctions: tradingFunctionSelectors
    };

    return await this.generateSessionKey(smartAccountAddress, permissions);
  }

  /**
   * Create session key for DCA strategies
   */
  async createDCAKey(
    smartAccountAddress: string,
    validityDays: number = 30,
    limitAmountEth: string = '10.0',
    dexRouterAddresses: string[] = []
  ): Promise<SessionKeyInfo> {
    const validUntil = Math.floor(Date.now() / 1000) + (validityDays * 24 * 3600);
    
    // DCA specific function selectors
    const dcaFunctionSelectors = [
      '0xa9059cbb', // transfer
      '0x095ea7b3', // approve
      '0x38ed1739', // swapExactTokensForTokens
      '0x7ff36ab5', // swapExactETHForTokens
    ];

    const permissions: SessionKeyPermissions = {
      validUntil,
      limitAmount: limitAmountEth,
      allowedTargets: dexRouterAddresses,
      allowedFunctions: dcaFunctionSelectors
    };

    return await this.generateSessionKey(smartAccountAddress, permissions);
  }

  /**
   * Sign transaction data with session key
   */
  async signTransactionData(
    sessionKeyAddress: string,
    target: string,
    data: string
  ): Promise<string | null> {
    try {
      const wallet = this.getSessionKeyWallet(sessionKeyAddress);
      if (!wallet) {
        return null;
      }

      // Extract function selector from data
      const functionSelector = data.slice(0, 10); // First 4 bytes + 0x

      // Check permissions
      if (!this.canCallFunction(sessionKeyAddress, target, functionSelector)) {
        logger.warn(`Session key ${sessionKeyAddress} not authorized for this call`);
        return null;
      }

      // Create message hash
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ['address', 'bytes'],
          [target, data]
        )
      );

      // Sign the hash
      return await wallet.signMessage(ethers.getBytes(messageHash));
    } catch (error: unknown) {
      logger.error(`Failed to sign transaction data with session key ${sessionKeyAddress}:`, error as Error);
      return null;
    }
  }

  /**
   * Get statistics about session keys
   */
  getStatistics(): {
    total: number;
    active: number;
    expired: number;
    totalSpent: string;
    totalLimit: string;
  } {
    const now = Math.floor(Date.now() / 1000);
    let active = 0;
    let expired = 0;
    let totalSpent = 0;
    let totalLimit = 0;

    for (const info of this.sessionKeys.values()) {
      if (info.isActive && info.validUntil > now) {
        active++;
      } else {
        expired++;
      }
      
      totalSpent += parseFloat(info.spentAmount);
      totalLimit += parseFloat(info.limitAmount);
    }

    return {
      total: this.sessionKeys.size,
      active,
      expired,
      totalSpent: totalSpent.toString(),
      totalLimit: totalLimit.toString()
    };
  }
}

export default SessionKeyWallet;
