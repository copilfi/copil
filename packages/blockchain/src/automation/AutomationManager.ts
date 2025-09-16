import { BlockchainLogger } from '../utils/Logger';
import { DexExecutor } from '../executors/DexExecutor';
import { ConditionalOrderEngineContract } from '../contracts/ConditionalOrderEngine';
import { SeiProvider } from '../providers/SeiProvider';
import { DCAScheduler, DCAStrategy, DCAExecution } from './DCAScheduler';
import { ConditionalOrderMonitor, ConditionalOrder, OrderExecution } from './ConditionalOrderMonitor';

export interface AutomationConfig {
  dcaCheckInterval?: number;
  conditionalOrderCheckInterval?: number;
  enableDCA?: boolean;
  enableConditionalOrders?: boolean;
  maxConcurrentExecutions?: number;
}

export interface AutomationStats {
  dca: {
    activeStrategies: number;
    totalExecutions: number;
    lastExecution?: Date;
  };
  conditionalOrders: {
    activeOrders: number;
    totalExecutions: number;
    lastExecution?: Date;
  };
  system: {
    uptime: number;
    isRunning: boolean;
    lastHeartbeat: Date;
  };
}

export class AutomationManager {
  private logger = BlockchainLogger.getInstance();
  private dcaScheduler: DCAScheduler;
  private conditionalOrderMonitor: ConditionalOrderMonitor;
  private isRunning = false;
  private startTime?: Date;
  private stats: AutomationStats;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    private seiProvider: SeiProvider,
    private dexExecutor: DexExecutor,
    private orderEngine: ConditionalOrderEngineContract,
    private config: AutomationConfig = {}
  ) {
    // Initialize components
    this.dcaScheduler = new DCAScheduler(
      seiProvider,
      dexExecutor,
      orderEngine,
      this.onDCAExecution.bind(this)
    );

    this.conditionalOrderMonitor = new ConditionalOrderMonitor(
      seiProvider,
      dexExecutor,
      orderEngine,
      this.onOrderExecution.bind(this)
    );

    // Initialize stats
    this.stats = {
      dca: {
        activeStrategies: 0,
        totalExecutions: 0
      },
      conditionalOrders: {
        activeOrders: 0,
        totalExecutions: 0
      },
      system: {
        uptime: 0,
        isRunning: false,
        lastHeartbeat: new Date()
      }
    };
  }

  /**
   * Start the automation manager
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Automation manager is already running');
      return;
    }

    this.logger.info('Starting Copil Automation Manager', { config: this.config });

    try {
      this.isRunning = true;
      this.startTime = new Date();

      // Start DCA scheduler if enabled
      if (this.config.enableDCA !== false) {
        this.dcaScheduler.start();
        this.logger.info('DCA scheduler started');
      }

      // Start conditional order monitor if enabled
      if (this.config.enableConditionalOrders !== false) {
        this.conditionalOrderMonitor.start();
        this.logger.info('Conditional order monitor started');
      }

      // Start heartbeat
      this.startHeartbeat();

      this.logger.info('🤖 Copil Automation Manager started successfully');
      this.updateSystemStats();

    } catch (error: unknown) {
      this.logger.error('Failed to start automation manager', undefined, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the automation manager
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Copil Automation Manager');

    try {
      // Stop components
      this.dcaScheduler.stop();
      this.conditionalOrderMonitor.stop();

      // Stop heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = undefined;
      }

      this.isRunning = false;
      this.updateSystemStats();

      this.logger.info('🛑 Copil Automation Manager stopped');

    } catch (error: unknown) {
      this.logger.error('Error while stopping automation manager', undefined, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Add a DCA strategy
   */
  async addDCAStrategy(params: {
    userId: string;
    tokenIn: string;
    tokenOut: string;
    totalBudget: bigint;
    frequency: number;
    maxExecutions: number;
    protocol: string;
    recipient?: string;
  }): Promise<DCAStrategy> {
    const strategy = await this.dcaScheduler.addStrategy({
      userId: params.userId,
      tokenIn: params.tokenIn as `0x${string}`,
      tokenOut: params.tokenOut as `0x${string}`,
      totalBudget: params.totalBudget,
      frequency: params.frequency,
      maxExecutions: params.maxExecutions,
      protocol: params.protocol as any,
      recipient: params.recipient as `0x${string}` | undefined
    });

    this.updateDCAStats();
    return strategy;
  }

  /**
   * Remove a DCA strategy
   */
  async removeDCAStrategy(strategyId: string, userId: string): Promise<boolean> {
    const result = await this.dcaScheduler.removeStrategy(strategyId, userId);
    this.updateDCAStats();
    return result;
  }

  /**
   * Add a conditional order
   */
  async addConditionalOrder(params: {
    orderId: string;
    userId: string;
    orderType: any;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    minAmountOut: bigint;
    conditions: any[];
    targetContract: string;
    callData: string;
  }): Promise<ConditionalOrder> {
    const order = await this.conditionalOrderMonitor.addOrder({
      orderId: params.orderId,
      userId: params.userId,
      orderType: params.orderType,
      tokenIn: params.tokenIn as `0x${string}`,
      tokenOut: params.tokenOut as `0x${string}`,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      conditions: params.conditions,
      targetContract: params.targetContract as `0x${string}`,
      callData: params.callData
    });

    this.updateConditionalOrderStats();
    return order;
  }

  /**
   * Remove a conditional order
   */
  async removeConditionalOrder(orderId: string, userId: string): Promise<boolean> {
    const result = await this.conditionalOrderMonitor.removeOrder(orderId, userId);
    this.updateConditionalOrderStats();
    return result;
  }

  /**
   * Get user's DCA strategies
   */
  getUserDCAStrategies(userId: string): DCAStrategy[] {
    return this.dcaScheduler.getUserStrategies(userId);
  }

  /**
   * Get user's conditional orders
   */
  getUserConditionalOrders(userId: string): ConditionalOrder[] {
    return this.conditionalOrderMonitor.getUserOrders(userId);
  }

  /**
   * Get automation statistics
   */
  getStats(): AutomationStats {
    this.updateSystemStats();
    return { ...this.stats };
  }

  /**
   * Get detailed status
   */
  getDetailedStatus(): {
    isRunning: boolean;
    uptime: number;
    dcaScheduler: any;
    conditionalOrderMonitor: any;
    stats: AutomationStats;
  } {
    return {
      isRunning: this.isRunning,
      uptime: this.getUptime(),
      dcaScheduler: this.dcaScheduler.getStatus(),
      conditionalOrderMonitor: this.conditionalOrderMonitor.getStatus(),
      stats: this.getStats()
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    components: {
      dcaScheduler: boolean;
      conditionalOrderMonitor: boolean;
      blockchain: boolean;
    };
    uptime: number;
    lastHeartbeat: Date;
  }> {
    const components = {
      dcaScheduler: this.dcaScheduler.getStatus().isRunning,
      conditionalOrderMonitor: this.conditionalOrderMonitor.getStatus().isRunning,
      blockchain: await this.checkBlockchainConnection()
    };

    const healthyComponents = Object.values(components).filter(Boolean).length;
    const totalComponents = Object.values(components).length;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (healthyComponents === totalComponents) {
      status = 'healthy';
    } else if (healthyComponents > 0) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      components,
      uptime: this.getUptime(),
      lastHeartbeat: this.stats.system.lastHeartbeat
    };
  }

  /**
   * Handle DCA execution callback
   */
  private async onDCAExecution(execution: DCAExecution): Promise<void> {
    this.logger.info('DCA execution completed', {
      strategyId: execution.strategyId,
      executionNumber: execution.executionNumber,
      transactionHash: execution.transactionHash
    });

    this.stats.dca.totalExecutions++;
    this.stats.dca.lastExecution = execution.executedAt;
  }

  /**
   * Handle conditional order execution callback
   */
  private async onOrderExecution(execution: OrderExecution): Promise<void> {
    this.logger.info('Conditional order execution completed', {
      orderId: execution.orderId,
      transactionHash: execution.transactionHash
    });

    this.stats.conditionalOrders.totalExecutions++;
    this.stats.conditionalOrders.lastExecution = execution.executedAt;
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.stats.system.lastHeartbeat = new Date();
      this.updateSystemStats();
    }, 30000); // Every 30 seconds
  }

  /**
   * Update DCA statistics
   */
  private updateDCAStats(): void {
    const dcaStatus = this.dcaScheduler.getStatus();
    this.stats.dca.activeStrategies = dcaStatus.activeStrategies;
  }

  /**
   * Update conditional order statistics
   */
  private updateConditionalOrderStats(): void {
    const orderStatus = this.conditionalOrderMonitor.getStatus();
    this.stats.conditionalOrders.activeOrders = orderStatus.activeOrders;
  }

  /**
   * Update system statistics
   */
  private updateSystemStats(): void {
    this.stats.system.isRunning = this.isRunning;
    this.stats.system.uptime = this.getUptime();
  }

  /**
   * Get uptime in seconds
   */
  private getUptime(): number {
    if (!this.startTime) return 0;
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }

  /**
   * Check blockchain connection
   */
  private async checkBlockchainConnection(): Promise<boolean> {
    try {
      const publicClient = this.seiProvider.getViemPublicClient();
      if (publicClient) {
        await publicClient.getBlockNumber();
        return true;
      }
      return false;
    } catch (error: unknown) {
      return false;
    }
  }
}