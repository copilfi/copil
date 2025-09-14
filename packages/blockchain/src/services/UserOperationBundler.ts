import { ethers, Wallet } from 'ethers';
import { BlockchainLogger } from '../utils/Logger';
import { UserOperation } from './SmartAccountService';

const logger = BlockchainLogger.getInstance();

export interface BundlerConfig {
  entryPointAddress: string;
  bundlerPrivateKey: string;
  rpcUrl: string;
  chainId: number;
  maxBundleSize: number;
  bundleInterval: number; // in milliseconds
}

export interface UserOperationReceipt {
  userOpHash: string;
  transactionHash: string;
  blockNumber: number;
  success: boolean;
  actualGasCost: string;
  actualGasUsed: string;
  logs: any[];
}

export interface PendingUserOp {
  userOp: UserOperation;
  hash: string;
  receivedAt: number;
  maxWaitTime: number;
}

export class UserOperationBundler {
  private provider: ethers.JsonRpcProvider;
  private config: BundlerConfig;
  private bundlerWallet: Wallet;
  private entryPointContract: ethers.Contract;
  private pendingUserOps: Map<string, PendingUserOp> = new Map();
  private bundleTimer?: NodeJS.Timeout;
  private isRunning = false;

  // Entry Point ABI for bundling
  private readonly ENTRY_POINT_ABI = [
    'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] calldata ops, address beneficiary) external',
    'function simulateValidation(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) calldata userOp) external',
    'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) calldata userOp) external view returns (bytes32)',
    'function getNonce(address sender, uint192 key) external view returns (uint256 nonce)',
    'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
    'event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)'
  ];

  constructor(config: BundlerConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.bundlerWallet = new Wallet(config.bundlerPrivateKey, this.provider);
    
    this.entryPointContract = new ethers.Contract(
      config.entryPointAddress,
      this.ENTRY_POINT_ABI,
      this.bundlerWallet
    );

    logger.info('UserOperationBundler initialized');
    logger.info(`  Entry Point: ${config.entryPointAddress}`);
    logger.info(`  Bundler Address: ${this.bundlerWallet.address}`);
    logger.info(`  Max Bundle Size: ${config.maxBundleSize}`);
    logger.info(`  Bundle Interval: ${config.bundleInterval}ms`);
  }

  /**
   * Start the bundler service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bundler is already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 Starting UserOperation bundler...');

    // Check bundler wallet balance
    const balance = await this.provider.getBalance(this.bundlerWallet.address);
    logger.info(`Bundler wallet balance: ${ethers.formatEther(balance)} ETH`);

    if (balance < ethers.parseEther('0.1')) {
      logger.warn('⚠️  Bundler wallet has low balance! Consider funding it for gas fees.');
    }

    // Start bundle processing timer
    this.bundleTimer = setInterval(async () => {
      try {
        await this.processPendingBundle();
      } catch (error) {
        logger.error('Error processing bundle:', error);
      }
    }, this.config.bundleInterval);

    logger.info('✅ UserOperation bundler started');
  }

  /**
   * Stop the bundler service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.bundleTimer) {
      clearInterval(this.bundleTimer);
      this.bundleTimer = undefined;
    }

    logger.info('🛑 UserOperation bundler stopped');
  }

  /**
   * Add UserOperation to pending queue
   */
  async addUserOperation(
    userOp: UserOperation,
    maxWaitTime: number = 30000 // 30 seconds default
  ): Promise<string> {
    try {
      // Calculate UserOp hash
      const userOpHash = await this.entryPointContract.getUserOpHash(userOp);
      
      // Validate UserOperation
      await this.validateUserOperation(userOp);
      
      // Add to pending queue
      const pendingUserOp: PendingUserOp = {
        userOp,
        hash: userOpHash,
        receivedAt: Date.now(),
        maxWaitTime
      };

      this.pendingUserOps.set(userOpHash, pendingUserOp);
      
      logger.info(`📥 Added UserOperation to queue: ${userOpHash}`);
      logger.info(`  From: ${userOp.sender}`);
      logger.info(`  Nonce: ${userOp.nonce}`);
      logger.info(`  Queue size: ${this.pendingUserOps.size}`);

      // Try immediate processing if queue is full or close to max wait time
      if (this.pendingUserOps.size >= this.config.maxBundleSize) {
        setImmediate(() => this.processPendingBundle());
      }

      return userOpHash;
    } catch (error) {
      logger.error('Failed to add UserOperation:', error);
      throw error;
    }
  }

  /**
   * Validate UserOperation before adding to queue
   */
  private async validateUserOperation(userOp: UserOperation): Promise<void> {
    try {
      // Check if sender exists or can be created
      const code = await this.provider.getCode(userOp.sender);
      const isDeployed = code !== '0x';
      
      if (!isDeployed && userOp.initCode === '0x') {
        throw new Error('Account not deployed and no initCode provided');
      }

      // Simulate validation (this would normally be done by the EntryPoint)
      // In production, you'd call simulateValidation on the EntryPoint
      logger.debug(`Validated UserOperation for ${userOp.sender}`);
      
    } catch (error) {
      logger.error('UserOperation validation failed:', error);
      throw error;
    }
  }

  /**
   * Process pending UserOperations into a bundle
   */
  private async processPendingBundle(): Promise<void> {
    if (this.pendingUserOps.size === 0) {
      return;
    }

    const now = Date.now();
    const userOpsToBundle: UserOperation[] = [];
    const hashesToRemove: string[] = [];

    // Select UserOps for bundling
    for (const [hash, pendingUserOp] of this.pendingUserOps.entries()) {
      const waitTime = now - pendingUserOp.receivedAt;
      
      // Include if max wait time reached or bundle is getting full
      if (waitTime >= pendingUserOp.maxWaitTime || userOpsToBundle.length >= this.config.maxBundleSize) {
        userOpsToBundle.push(pendingUserOp.userOp);
        hashesToRemove.push(hash);
      }
      
      // Stop if we've reached max bundle size
      if (userOpsToBundle.length >= this.config.maxBundleSize) {
        break;
      }
    }

    if (userOpsToBundle.length === 0) {
      return;
    }

    try {
      logger.info(`📦 Processing bundle with ${userOpsToBundle.length} UserOperations`);
      
      // Execute bundle
      const receipt = await this.executeBundle(userOpsToBundle);
      
      // Remove processed UserOps from queue
      hashesToRemove.forEach(hash => this.pendingUserOps.delete(hash));
      
      logger.info(`✅ Bundle executed successfully: ${receipt.transactionHash}`);
      logger.info(`  Gas used: ${receipt.gasUsed}`);
      logger.info(`  Remaining queue size: ${this.pendingUserOps.size}`);
      
    } catch (error) {
      logger.error('Failed to execute bundle:', error);
      
      // On failure, remove UserOps from queue to prevent retry loops
      // In production, you might want more sophisticated retry logic
      hashesToRemove.forEach(hash => this.pendingUserOps.delete(hash));
    }
  }

  /**
   * Execute a bundle of UserOperations
   */
  private async executeBundle(userOps: UserOperation[]): Promise<any> {
    try {
      // Estimate gas for the bundle
      const gasEstimate = await this.entryPointContract.handleOps.estimateGas(
        userOps,
        this.bundlerWallet.address
      );

      logger.info(`Executing bundle with ${userOps.length} UserOperations`);
      logger.info(`Estimated gas: ${gasEstimate.toString()}`);

      // Execute handleOps transaction
      const tx = await this.entryPointContract.handleOps(
        userOps,
        this.bundlerWallet.address,
        {
          gasLimit: gasEstimate + BigInt(50000), // Add some buffer
        }
      );

      // Wait for transaction confirmation
      const receipt = await tx.wait();
      
      // Parse events to get UserOperation results
      const userOpEvents = this.parseUserOperationEvents(receipt);
      
      return {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        userOperationResults: userOpEvents
      };
      
    } catch (error) {
      logger.error('Bundle execution failed:', error);
      throw error;
    }
  }

  /**
   * Parse UserOperationEvent logs from transaction receipt
   */
  private parseUserOperationEvents(receipt: any): UserOperationReceipt[] {
    const results: UserOperationReceipt[] = [];
    
    try {
      const userOpEvents = receipt.logs
        .map((log: any) => {
          try {
            return this.entryPointContract.interface.parseLog({
              topics: log.topics,
              data: log.data
            });
          } catch {
            return null;
          }
        })
        .filter((log: any) => log && log.name === 'UserOperationEvent');

      for (const event of userOpEvents) {
        results.push({
          userOpHash: event.args.userOpHash,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          success: event.args.success,
          actualGasCost: event.args.actualGasCost.toString(),
          actualGasUsed: event.args.actualGasUsed.toString(),
          logs: receipt.logs
        });
      }
      
    } catch (error) {
      logger.error('Failed to parse UserOperation events:', error);
    }
    
    return results;
  }

  /**
   * Get UserOperation receipt by hash
   */
  async getUserOperationReceipt(userOpHash: string): Promise<UserOperationReceipt | null> {
    try {
      // In a production bundler, you'd store receipts in a database
      // For now, we'll search recent blocks for the UserOperationEvent
      
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 100); // Search last 100 blocks
      
      const filter = this.entryPointContract.filters.UserOperationEvent(userOpHash);
      const events = await this.entryPointContract.queryFilter(filter, fromBlock, currentBlock);
      
      if (events.length === 0) {
        return null;
      }
      
      const event = events[0];
      const receipt = await event.getTransactionReceipt();
      
      return {
        userOpHash,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        success: event.args.success,
        actualGasCost: event.args.actualGasCost.toString(),
        actualGasUsed: event.args.actualGasUsed.toString(),
        logs: receipt.logs
      };
      
    } catch (error) {
      logger.error(`Failed to get UserOperation receipt for ${userOpHash}:`, error);
      return null;
    }
  }

  /**
   * Get pending UserOperation by hash
   */
  getPendingUserOperation(userOpHash: string): PendingUserOp | null {
    return this.pendingUserOps.get(userOpHash) || null;
  }

  /**
   * Remove UserOperation from pending queue
   */
  removePendingUserOperation(userOpHash: string): boolean {
    return this.pendingUserOps.delete(userOpHash);
  }

  /**
   * Get bundler statistics
   */
  getStatistics(): {
    isRunning: boolean;
    pendingUserOps: number;
    bundlerAddress: string;
    bundlerBalance: string;
    config: BundlerConfig;
  } {
    return {
      isRunning: this.isRunning,
      pendingUserOps: this.pendingUserOps.size,
      bundlerAddress: this.bundlerWallet.address,
      bundlerBalance: '0', // Would be fetched async in real implementation
      config: this.config
    };
  }

  /**
   * Clean up expired UserOperations
   */
  cleanupExpiredUserOps(): number {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [hash, pendingUserOp] of this.pendingUserOps.entries()) {
      const age = now - pendingUserOp.receivedAt;
      const maxAge = pendingUserOp.maxWaitTime * 3; // Allow 3x max wait time before cleanup
      
      if (age > maxAge) {
        this.pendingUserOps.delete(hash);
        cleanedCount++;
        logger.info(`Cleaned up expired UserOperation: ${hash}`);
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired UserOperations`);
    }
    
    return cleanedCount;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check provider connection
      await this.provider.getBlockNumber();
      
      // Check entry point contract
      await this.entryPointContract.getNonce(ethers.ZeroAddress, 0);
      
      // Check bundler wallet balance
      const balance = await this.provider.getBalance(this.bundlerWallet.address);
      if (balance < ethers.parseEther('0.01')) {
        logger.warn('⚠️  Bundler wallet balance is critically low');
        return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Bundler health check failed:', error);
      return false;
    }
  }
}

export default UserOperationBundler;