import { Address } from 'viem';
import { BlockchainLogger } from '../utils/Logger';
import { DexExecutor } from '../executors/DexExecutor';
import { ConditionalOrderEngineContract, OrderType } from '../contracts/ConditionalOrderEngine';
import { SeiProvider } from '../providers/SeiProvider';

export interface ConditionalOrder {
  orderId: string;
  userId: string;
  orderType: OrderType;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  conditions: OrderCondition[];
  targetContract: Address;
  callData: string;
  isActive: boolean;
  createdAt: Date;
  lastCheckedAt?: Date;
  executedAt?: Date;
  transactionHash?: string;
}

export interface OrderCondition {
  conditionType: ConditionType;
  tokenAddress: Address;
  targetValue: string;
  currentValue: string;
  isMet: boolean;
  extraData: string;
}

export enum ConditionType {
  PRICE_ABOVE = 0,
  PRICE_BELOW = 1,
  TIME_BASED = 2,
  BALANCE_THRESHOLD = 3
}

export interface OrderExecution {
  orderId: string;
  transactionHash: string;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
  executedAt: Date;
  conditions: OrderCondition[];
}

export class ConditionalOrderMonitor {
  private logger = BlockchainLogger.getInstance();
  private orders: Map<string, ConditionalOrder> = new Map();
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;
  private readonly checkIntervalMs = 15000; // Check every 15 seconds
  private priceCache: Map<string, { price: bigint; timestamp: number }> = new Map();
  private readonly priceCacheMs = 5000; // Cache prices for 5 seconds

  constructor(
    private seiProvider: SeiProvider,
    private dexExecutor: DexExecutor,
    private orderEngine: ConditionalOrderEngineContract,
    private onExecutionCallback?: (execution: OrderExecution) => Promise<void>
  ) {}

  /**
   * Start the conditional order monitor
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Conditional order monitor is already running');
      return;
    }

    this.logger.info('Starting conditional order monitor', {
      checkInterval: this.checkIntervalMs / 1000 + 's'
    });

    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.processConditionalOrders().catch((error) => {
        this.logger.error('Error processing conditional orders', undefined, { error: error.message });
      });
    }, this.checkIntervalMs);

    // Initial execution
    this.processConditionalOrders().catch((error) => {
      this.logger.error('Error in initial conditional order processing', undefined, { error: error.message });
    });
  }

  /**
   * Stop the conditional order monitor
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping conditional order monitor');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Add a conditional order to monitor
   */
  async addOrder(params: {
    orderId: string;
    userId: string;
    orderType: OrderType;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    minAmountOut: bigint;
    conditions: OrderCondition[];
    targetContract: Address;
    callData: string;
  }): Promise<ConditionalOrder> {
    const order: ConditionalOrder = {
      ...params,
      isActive: true,
      createdAt: new Date()
    };

    this.orders.set(params.orderId, order);
    
    this.logger.info('Conditional order added to monitor', {
      orderId: params.orderId,
      userId: params.userId,
      orderType: params.orderType,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      conditionsCount: params.conditions.length
    });

    return order;
  }

  /**
   * Remove an order from monitoring
   */
  async removeOrder(orderId: string, userId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    
    if (!order) {
      return false;
    }

    if (order.userId !== userId) {
      throw new Error('Unauthorized: Order belongs to different user');
    }

    order.isActive = false;
    this.orders.delete(orderId);
    
    this.logger.info('Conditional order removed from monitor', { orderId, userId });
    return true;
  }

  /**
   * Get all orders for a user
   */
  getUserOrders(userId: string): ConditionalOrder[] {
    return Array.from(this.orders.values()).filter(
      order => order.userId === userId
    );
  }

  /**
   * Get a specific order
   */
  getOrder(orderId: string, userId?: string): ConditionalOrder | null {
    const order = this.orders.get(orderId);
    
    if (!order) {
      return null;
    }

    if (userId && order.userId !== userId) {
      return null; // Hide orders from other users
    }

    return order;
  }

  /**
   * Process all conditional orders
   */
  private async processConditionalOrders(): Promise<void> {
    const activeOrders = Array.from(this.orders.values()).filter(
      order => order.isActive && !order.executedAt
    );

    if (activeOrders.length === 0) {
      return;
    }

    this.logger.debug(`Checking ${activeOrders.length} conditional orders`);

    for (const order of activeOrders) {
      try {
        await this.checkAndExecuteOrder(order);
        order.lastCheckedAt = new Date();
      } catch (error) {
        this.logger.error(`Failed to process conditional order: ${order.orderId}`, undefined, {
          error: error instanceof Error ? error.message : 'Unknown error',
          orderId: order.orderId
        });
      }
    }
  }

  /**
   * Check if order conditions are met and execute if ready
   */
  private async checkAndExecuteOrder(order: ConditionalOrder): Promise<void> {
    this.logger.debug('Checking order conditions', { orderId: order.orderId });

    // Update condition values
    for (const condition of order.conditions) {
      await this.updateConditionValue(condition);
    }

    // Check if all conditions are met
    const allConditionsMet = order.conditions.every(condition => condition.isMet);

    if (!allConditionsMet) {
      this.logger.debug('Order conditions not met', {
        orderId: order.orderId,
        metConditions: order.conditions.filter(c => c.isMet).length,
        totalConditions: order.conditions.length
      });
      return;
    }

    this.logger.info('All conditions met, executing order', { orderId: order.orderId });

    try {
      // Execute the order
      const result = await this.orderEngine.executeOrder(order.orderId);

      // Update order status
      order.executedAt = new Date();
      order.transactionHash = result.transactionHash;
      order.isActive = false;

      // Create execution record
      const execution: OrderExecution = {
        orderId: order.orderId,
        transactionHash: result.transactionHash,
        amountIn: order.amountIn,
        amountOut: BigInt(0), // Would extract from transaction logs
        gasUsed: BigInt(0), // Would extract from transaction receipt
        executedAt: new Date(),
        conditions: [...order.conditions]
      };

      this.logger.info('Conditional order executed successfully', {
        orderId: order.orderId,
        transactionHash: result.transactionHash
      });

      // Call callback if provided
      if (this.onExecutionCallback) {
        await this.onExecutionCallback(execution);
      }

    } catch (error) {
      this.logger.error('Failed to execute conditional order', undefined, {
        orderId: order.orderId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Update the current value for a condition
   */
  private async updateConditionValue(condition: OrderCondition): Promise<void> {
    try {
      switch (condition.conditionType) {
        case ConditionType.PRICE_ABOVE:
        case ConditionType.PRICE_BELOW:
          await this.updatePriceCondition(condition);
          break;
        case ConditionType.TIME_BASED:
          await this.updateTimeCondition(condition);
          break;
        case ConditionType.BALANCE_THRESHOLD:
          await this.updateBalanceCondition(condition);
          break;
        default:
          this.logger.warn('Unknown condition type', { conditionType: condition.conditionType });
      }
    } catch (error) {
      this.logger.error('Failed to update condition value', undefined, {
        conditionType: condition.conditionType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update price-based condition
   */
  private async updatePriceCondition(condition: OrderCondition): Promise<void> {
    const price = await this.getCurrentPrice(condition.tokenAddress);
    condition.currentValue = price.toString();

    const targetPrice = BigInt(condition.targetValue);
    
    if (condition.conditionType === ConditionType.PRICE_ABOVE) {
      condition.isMet = price >= targetPrice;
    } else if (condition.conditionType === ConditionType.PRICE_BELOW) {
      condition.isMet = price <= targetPrice;
    }
  }

  /**
   * Update time-based condition
   */
  private async updateTimeCondition(condition: OrderCondition): Promise<void> {
    const currentTime = Math.floor(Date.now() / 1000);
    condition.currentValue = currentTime.toString();

    const targetTime = parseInt(condition.targetValue);
    condition.isMet = currentTime >= targetTime;
  }

  /**
   * Update balance-based condition
   */
  private async updateBalanceCondition(condition: OrderCondition): Promise<void> {
    const balance = await this.getTokenBalance(condition.tokenAddress);
    condition.currentValue = balance.toString();

    const targetBalance = BigInt(condition.targetValue);
    condition.isMet = balance >= targetBalance;
  }

  /**
   * Get current price for a token (with caching)
   */
  private async getCurrentPrice(tokenAddress: Address): Promise<bigint> {
    const cacheKey = tokenAddress.toLowerCase();
    const cached = this.priceCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.priceCacheMs) {
      return cached.price;
    }

    try {
      // Get price quote for 1 token unit
      const oneTokenUnit = BigInt(10) ** BigInt(18); // Assuming 18 decimals
      const quote = await this.dexExecutor.getBestQuote({
        tokenIn: tokenAddress,
        tokenOut: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392', // USDC as reference
        amountIn: oneTokenUnit
      });

      const price = quote.amountOut;
      this.priceCache.set(cacheKey, { price, timestamp: Date.now() });
      
      return price;
    } catch (error) {
      this.logger.warn('Failed to get current price, using fallback', {
        tokenAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return BigInt(0);
    }
  }

  /**
   * Get token balance for address
   */
  private async getTokenBalance(tokenAddress: Address): Promise<bigint> {
    try {
      // For native SEI
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
      this.logger.error('Failed to get token balance', undefined, { tokenAddress });
      return 0n;
    }
  }

  /**
   * Get monitor status
   */
  getStatus(): {
    isRunning: boolean;
    activeOrders: number;
    totalOrders: number;
    checkInterval: number;
    priceCacheSize: number;
  } {
    const activeCount = Array.from(this.orders.values()).filter(o => o.isActive).length;
    
    return {
      isRunning: this.isRunning,
      activeOrders: activeCount,
      totalOrders: this.orders.size,
      checkInterval: this.checkIntervalMs / 1000,
      priceCacheSize: this.priceCache.size
    };
  }
}