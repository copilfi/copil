import { Address } from 'viem';
import { BlockchainLogger } from '../utils/Logger';
import { DexExecutor, DexProtocol } from '../executors/DexExecutor';
import { ConditionalOrderEngineContract } from '../contracts/ConditionalOrderEngine';
import { SeiProvider } from '../providers/SeiProvider';

export interface DCAStrategy {
  id: string;
  userId: string;
  tokenIn: Address;
  tokenOut: Address;
  totalBudget: bigint;
  amountPerExecution: bigint;
  frequency: number; // seconds
  maxExecutions: number;
  executedCount: number;
  protocol: DexProtocol;
  isActive: boolean;
  createdAt: Date;
  nextExecutionAt: Date;
  lastExecutedAt?: Date;
  recipient?: Address;
}

export interface DCAExecution {
  strategyId: string;
  executionNumber: number;
  amountIn: bigint;
  amountOut: bigint;
  transactionHash: string;
  executedAt: Date;
  gasUsed: bigint;
  protocol: DexProtocol;
}

export class DCAScheduler {
  private logger = BlockchainLogger.getInstance();
  private strategies: Map<string, DCAStrategy> = new Map();
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;
  private readonly checkIntervalMs = 30000; // Check every 30 seconds

  constructor(
    private seiProvider: SeiProvider,
    private dexExecutor: DexExecutor,
    private orderEngine: ConditionalOrderEngineContract,
    private onExecutionCallback?: (execution: DCAExecution) => Promise<void>
  ) {}

  /**
   * Start the DCA scheduler
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('DCA scheduler is already running');
      return;
    }

    this.logger.info('Starting DCA scheduler', {
      checkInterval: this.checkIntervalMs / 1000 + 's'
    });

    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.processScheduledExecutions().catch((error) => {
        this.logger.error('Error processing DCA executions', undefined, { error: error.message });
      });
    }, this.checkIntervalMs);

    // Initial execution
    this.processScheduledExecutions().catch((error) => {
      this.logger.error('Error in initial DCA execution processing', undefined, { error: error.message });
    });
  }

  /**
   * Stop the DCA scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping DCA scheduler');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Add a new DCA strategy
   */
  async addStrategy(params: {
    userId: string;
    tokenIn: Address;
    tokenOut: Address;
    totalBudget: bigint;
    frequency: number;
    maxExecutions: number;
    protocol: DexProtocol;
    recipient?: Address;
  }): Promise<DCAStrategy> {
    const strategyId = this.generateStrategyId();
    const amountPerExecution = params.totalBudget / BigInt(params.maxExecutions);
    
    const strategy: DCAStrategy = {
      id: strategyId,
      userId: params.userId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      totalBudget: params.totalBudget,
      amountPerExecution,
      frequency: params.frequency,
      maxExecutions: params.maxExecutions,
      executedCount: 0,
      protocol: params.protocol,
      isActive: true,
      createdAt: new Date(),
      nextExecutionAt: new Date(Date.now() + params.frequency * 1000),
      recipient: params.recipient
    };

    this.strategies.set(strategyId, strategy);
    
    this.logger.info('DCA strategy created', {
      strategyId,
      userId: params.userId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      maxExecutions: params.maxExecutions,
      frequency: params.frequency
    });

    return strategy;
  }

  /**
   * Remove a DCA strategy
   */
  async removeStrategy(strategyId: string, userId: string): Promise<boolean> {
    const strategy = this.strategies.get(strategyId);
    
    if (!strategy) {
      return false;
    }

    if (strategy.userId !== userId) {
      throw new Error('Unauthorized: Strategy belongs to different user');
    }

    strategy.isActive = false;
    this.strategies.delete(strategyId);
    
    this.logger.info('DCA strategy removed', { strategyId, userId });
    return true;
  }

  /**
   * Get all strategies for a user
   */
  getUserStrategies(userId: string): DCAStrategy[] {
    return Array.from(this.strategies.values()).filter(
      strategy => strategy.userId === userId
    );
  }

  /**
   * Get a specific strategy
   */
  getStrategy(strategyId: string, userId?: string): DCAStrategy | null {
    const strategy = this.strategies.get(strategyId);
    
    if (!strategy) {
      return null;
    }

    if (userId && strategy.userId !== userId) {
      return null; // Hide strategies from other users
    }

    return strategy;
  }

  /**
   * Process all scheduled executions
   */
  private async processScheduledExecutions(): Promise<void> {
    const now = new Date();
    const readyStrategies = Array.from(this.strategies.values()).filter(
      strategy => 
        strategy.isActive &&
        strategy.executedCount < strategy.maxExecutions &&
        strategy.nextExecutionAt <= now
    );

    if (readyStrategies.length === 0) {
      return;
    }

    this.logger.info(`Processing ${readyStrategies.length} DCA executions`);

    for (const strategy of readyStrategies) {
      try {
        await this.executeStrategy(strategy);
      } catch (error) {
        this.logger.error(`Failed to execute DCA strategy: ${strategy.id}`, undefined, {
          error: error instanceof Error ? error.message : 'Unknown error',
          strategyId: strategy.id
        });
        
        // Mark strategy as inactive after multiple failures
        if (this.shouldDeactivateStrategy(strategy)) {
          strategy.isActive = false;
          this.logger.warn(`Deactivating DCA strategy after repeated failures: ${strategy.id}`);
        }
      }
    }
  }

  /**
   * Execute a single DCA strategy
   */
  private async executeStrategy(strategy: DCAStrategy): Promise<void> {
    this.logger.info('Executing DCA strategy', {
      strategyId: strategy.id,
      executionNumber: strategy.executedCount + 1,
      amountIn: strategy.amountPerExecution.toString()
    });

    try {
      // Check wallet balance
      const balance = await this.checkWalletBalance(strategy.tokenIn);
      if (balance < strategy.amountPerExecution) {
        this.logger.error('Insufficient balance for DCA execution', undefined, {
          strategyId: strategy.id,
          required: strategy.amountPerExecution.toString(),
          available: balance.toString()
        });
        return;
      }

      // Execute the swap
      const swapResult = await this.dexExecutor.executeSwap({
        protocol: strategy.protocol,
        tokenIn: strategy.tokenIn,
        tokenOut: strategy.tokenOut,
        amountIn: strategy.amountPerExecution,
        recipient: strategy.recipient
      });

      // Update strategy
      strategy.executedCount++;
      strategy.lastExecutedAt = new Date();
      strategy.nextExecutionAt = new Date(Date.now() + strategy.frequency * 1000);

      // Check if strategy is complete
      if (strategy.executedCount >= strategy.maxExecutions) {
        strategy.isActive = false;
        this.logger.info('DCA strategy completed', { strategyId: strategy.id });
      }

      // Create execution record
      const execution: DCAExecution = {
        strategyId: strategy.id,
        executionNumber: strategy.executedCount,
        amountIn: strategy.amountPerExecution,
        amountOut: swapResult.amountOut,
        transactionHash: swapResult.hash,
        executedAt: new Date(),
        gasUsed: swapResult.gasUsed,
        protocol: strategy.protocol
      };

      this.logger.info('DCA execution completed', {
        strategyId: strategy.id,
        transactionHash: swapResult.hash,
        amountOut: swapResult.amountOut.toString()
      });

      // Call callback if provided
      if (this.onExecutionCallback) {
        await this.onExecutionCallback(execution);
      }

    } catch (error) {
      this.logger.error('DCA execution failed', undefined, {
        strategyId: strategy.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check wallet balance for token
   */
  private async checkWalletBalance(tokenAddress: Address): Promise<bigint> {
    try {
      // For native SEI (zero address)
      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        const publicClient = this.seiProvider.getViemPublicClient();
        if (publicClient) {
          return await publicClient.getBalance({ 
            address: this.seiProvider.getAddress() as Address
          });
        }
        return 0n;
      }

      // For ERC-20 tokens
      const publicClient = this.seiProvider.getViemPublicClient();
      if (publicClient) {
        const balance = await publicClient.readContract({
          address: tokenAddress,
          abi: [{
            type: 'function',
            name: 'balanceOf',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: 'balance', type: 'uint256' }]
          }],
          functionName: 'balanceOf',
          args: [this.seiProvider.getAddress() as Address]
        });
        return balance as bigint;
      }

      return 0n;
    } catch (error) {
      this.logger.error('Failed to check wallet balance', undefined, { tokenAddress });
      return 0n;
    }
  }

  /**
   * Check if strategy should be deactivated after failures
   */
  private shouldDeactivateStrategy(strategy: DCAStrategy): boolean {
    // Simple logic: deactivate after 5 consecutive hours of failures
    const lastExecution = strategy.lastExecutedAt;
    if (!lastExecution) {
      // If never executed and created more than 1 hour ago, deactivate
      return (Date.now() - strategy.createdAt.getTime()) > 3600000;
    }

    // If last execution was more than 5 intervals ago, deactivate
    const maxFailureTime = strategy.frequency * 5 * 1000; // 5 intervals
    return (Date.now() - lastExecution.getTime()) > maxFailureTime;
  }

  /**
   * Generate unique strategy ID
   */
  private generateStrategyId(): string {
    return `dca_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    activeStrategies: number;
    totalStrategies: number;
    checkInterval: number;
  } {
    const activeCount = Array.from(this.strategies.values()).filter(s => s.isActive).length;
    
    return {
      isRunning: this.isRunning,
      activeStrategies: activeCount,
      totalStrategies: this.strategies.size,
      checkInterval: this.checkIntervalMs / 1000
    };
  }
}