import { Contract, ethers } from 'ethers';
import type { SeiProvider } from '../providers/SeiProvider';
import { ContractError } from '../types/errors';
import { CONDITIONAL_ORDER_ENGINE_ABI } from '../constants/contracts';

export enum OrderType {
  LIMIT_BUY,
  LIMIT_SELL,
  STOP_LOSS,
  TAKE_PROFIT,
  DCA,
  GRID_TRADING,
  YIELD_HARVEST,
  REBALANCE,
  LIQUIDATION_PROTECTION
}

export enum OrderStatus {
  ACTIVE,
  EXECUTED,
  CANCELLED,
  EXPIRED,
  FAILED
}

export enum ConditionType {
  PRICE_ABOVE,
  PRICE_BELOW,
  PRICE_CHANGE_PERCENT,
  TIME_BASED,
  VOLUME_THRESHOLD,
  LIQUIDITY_THRESHOLD,
  YIELD_THRESHOLD,
  CUSTOM_LOGIC
}

export interface Condition {
  conditionType: ConditionType;
  tokenAddress: string;
  targetValue: string;
  currentValue: string;
  isMet: boolean;
  extraData: string;
}

export interface CreateOrderParams {
  orderType: OrderType;
  conditions: Condition[];
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  minOutputAmount: string;
  deadline: number;
  targetContract: string;
  callData: string;
  requiresAllConditions: boolean;
}

export class ConditionalOrderEngineContract {
  private contract: Contract;

  constructor(
    private provider: SeiProvider,
    private engineAddress: string,
    signer?: any
  ) {
    const evmProvider = signer || provider.getEvmProvider();
    this.contract = new Contract(engineAddress, CONDITIONAL_ORDER_ENGINE_ABI, evmProvider);
  }

  /**
   * Create a new conditional order
   */
  async createOrder(params: CreateOrderParams): Promise<{
    orderId: string;
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.createOrder(
        params.orderType,
        params.conditions,
        params.inputToken,
        params.outputToken,
        params.inputAmount,
        params.minOutputAmount,
        params.deadline,
        params.targetContract,
        params.callData,
        params.requiresAllConditions
      );

      const receipt = await tx.wait();
      
      // Find OrderCreated event
      const event = receipt.logs.find((log: any) => 
        log.topics[0] === this.contract.interface.getEvent('OrderCreated')?.topicHash
      );

      if (!event) {
        throw new ContractError('OrderCreated event not found', this.engineAddress);
      }

      const decodedEvent = this.contract.interface.parseLog(event);
      if (!decodedEvent) {
        throw new ContractError('Failed to decode OrderCreated event', this.engineAddress);
      }
      
      return {
        orderId: decodedEvent.args.orderId.toString(),
        transactionHash: receipt.hash
      };
    } catch (error) {
      throw new ContractError(
        'Failed to create conditional order',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Create a DCA (Dollar Cost Averaging) order
   */
  async createDCAOrder(
    inputToken: string,
    outputToken: string,
    totalBudget: string,
    frequency: number,
    maxExecutions: number,
    targetContract: string,
    callDataTemplate: string
  ): Promise<{
    orderId: string;
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.createDCAOrder(
        inputToken,
        outputToken,
        totalBudget,
        frequency,
        maxExecutions,
        targetContract,
        callDataTemplate
      );

      const receipt = await tx.wait();
      
      const event = receipt.logs.find((log: any) => 
        log.topics[0] === this.contract.interface.getEvent('OrderCreated')?.topicHash
      );

      const decodedEvent = this.contract.interface.parseLog(event);
      if (!decodedEvent) {
        throw new ContractError('Failed to decode OrderCreated event', this.engineAddress);
      }
      
      return {
        orderId: decodedEvent.args.orderId.toString(),
        transactionHash: receipt.hash
      };
    } catch (error) {
      throw new ContractError(
        'Failed to create DCA order',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Execute a conditional order
   */
  async executeOrder(orderId: string): Promise<{
    transactionHash: string;
    success: boolean;
    gasUsed: string;
    reward: string;
  }> {
    try {
      const tx = await this.contract.executeOrder(orderId);
      const receipt = await tx.wait();
      
      // Find OrderExecuted event
      const event = receipt.logs.find((log: any) => 
        log.topics[0] === this.contract.interface.getEvent('OrderExecuted')?.topicHash
      );

      let gasUsed = '0';
      let reward = '0';

      if (event) {
        const decodedEvent = this.contract.interface.parseLog(event);
        if (decodedEvent) {
          gasUsed = decodedEvent.args.gasUsed.toString();
          reward = decodedEvent.args.reward.toString();
        }
      }
      
      return {
        transactionHash: receipt.hash,
        success: receipt.status === 1,
        gasUsed,
        reward
      };
    } catch (error) {
      throw new ContractError(
        'Failed to execute conditional order',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Cancel a conditional order
   */
  async cancelOrder(orderId: string): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.cancelOrder(orderId);
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error) {
      throw new ContractError(
        'Failed to cancel conditional order',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Get order details
   */
  async getOrder(orderId: string): Promise<{
    owner: string;
    orderType: OrderType;
    status: OrderStatus;
    inputToken: string;
    inputAmount: string;
    deadline: number;
  }> {
    try {
      const order = await this.contract.getOrder(orderId);
      
      return {
        owner: order.owner,
        orderType: order.orderType,
        status: order.status,
        inputToken: order.inputToken,
        inputAmount: order.inputAmount.toString(),
        deadline: order.deadline
      };
    } catch (error) {
      throw new ContractError(
        'Failed to get order details',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Get user's orders
   */
  async getUserOrders(userAddress: string): Promise<string[]> {
    try {
      const orderIds = await this.contract.getUserOrders(userAddress);
      return orderIds.map((id: any) => id.toString());
    } catch (error) {
      throw new ContractError(
        'Failed to get user orders',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Update token price (owner only)
   */
  async updateTokenPrice(token: string, price: string): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.updateTokenPrice(token, price);
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error) {
      throw new ContractError(
        'Failed to update token price',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Authorize an executor
   */
  async authorizeExecutor(executor: string): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.authorizeExecutor(executor);
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error) {
      throw new ContractError(
        'Failed to authorize executor',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Revoke executor authorization
   */
  async revokeExecutor(executor: string): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.revokeExecutor(executor);
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error) {
      throw new ContractError(
        'Failed to revoke executor',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Get executable orders (for executors)
   */
  async getExecutableOrders(limit: number = 100): Promise<Array<{
    orderId: string;
    owner: string;
    orderType: OrderType;
    estimatedReward: string;
    gasEstimate: string;
  }>> {
    try {
      // This would require a view function in the contract to return executable orders
      // For now, return empty array - would need contract enhancement
      return [];
    } catch (error) {
      throw new ContractError(
        'Failed to get executable orders',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Simulate order execution (estimate gas and check conditions)
   */
  async simulateExecution(orderId: string): Promise<{
    canExecute: boolean;
    gasEstimate: string;
    expectedReward: string;
    failureReason?: string;
  }> {
    try {
      // This would require simulation functionality in the contract
      // For now, return basic simulation
      const gasEstimate = await this.contract.executeOrder.estimateGas(orderId);
      
      return {
        canExecute: true,
        gasEstimate: gasEstimate.toString(),
        expectedReward: '0'
      };
    } catch (error: any) {
      return {
        canExecute: false,
        gasEstimate: '0',
        expectedReward: '0',
        failureReason: error.message
      };
    }
  }

  /**
   * Listen to order events
   */
  onOrderCreated(
    callback: (orderId: string, owner: string, orderType: OrderType) => void
  ): void {
    this.contract.on('OrderCreated', (orderId, owner, orderType) => {
      callback(orderId.toString(), owner, orderType);
    });
  }

  onOrderExecuted(
    callback: (orderId: string, executor: string, gasUsed: string, reward: string) => void
  ): void {
    this.contract.on('OrderExecuted', (orderId, executor, gasUsed, reward) => {
      callback(orderId.toString(), executor, gasUsed.toString(), reward.toString());
    });
  }

  onOrderCancelled(
    callback: (orderId: string, owner: string) => void
  ): void {
    this.contract.on('OrderCancelled', (orderId, owner) => {
      callback(orderId.toString(), owner);
    });
  }

  /**
   * Get order execution history
   */
  async getExecutionHistory(
    fromBlock: number = 0,
    toBlock: number | 'latest' = 'latest',
    orderId?: string
  ): Promise<Array<{
    orderId: string;
    executor: string;
    gasUsed: string;
    reward: string;
    blockNumber: number;
    transactionHash: string;
  }>> {
    try {
      const filter = this.contract.filters.OrderExecuted(orderId, null, null, null);
      const events = await this.contract.queryFilter(filter, fromBlock, toBlock);

      return events.map((event: any) => ({
        orderId: event.args.orderId.toString(),
        executor: event.args.executor,
        gasUsed: event.args.gasUsed.toString(),
        reward: event.args.reward.toString(),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      }));
    } catch (error) {
      throw new ContractError(
        'Failed to get execution history',
        this.engineAddress,
        error
      );
    }
  }

  /**
   * Get contract instance
   */
  getContract(): Contract {
    return this.contract;
  }

  /**
   * Get engine address
   */
  getAddress(): string {
    return this.engineAddress;
  }
}