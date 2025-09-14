import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { RealBlockchainService } from './RealBlockchainService';
import { ethers } from 'ethers';

export interface StrategyCondition {
  type: 'price' | 'time' | 'volume' | 'technical_indicator';
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: string;
  tokenAddress?: string;
  indicator?: string;
}

export interface StrategyParameters {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  slippage: number;
  dexRouter: string;
  gasLimit: string;
  maxGasPrice: string;
}

export interface ExecutionContext {
  strategyId: string;
  userId: string;
  smartAccountAddress: string;
  sessionKeyAddress: string;
  conditions: StrategyCondition[];
  parameters: StrategyParameters;
}

export class StrategyExecutionEngine {
  private prisma: PrismaClient;
  private blockchainService: RealBlockchainService;
  private isRunning: boolean = false;
  private executionInterval: NodeJS.Timeout | null = null;

  constructor(prisma: PrismaClient, blockchainService: RealBlockchainService) {
    this.prisma = prisma;
    this.blockchainService = blockchainService;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Strategy execution engine is already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 Starting strategy execution engine...');

    this.executionInterval = setInterval(async () => {
      await this.executeStrategies();
    }, 30000); // Execute every 30 seconds

    logger.info('✅ Strategy execution engine started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
    }

    logger.info('🛑 Strategy execution engine stopped');
  }

  private async executeStrategies(): Promise<void> {
    try {
      const activeStrategies = await this.prisma.strategy.findMany({
        where: {
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        },
        include: {
          user: {
            include: {
              sessions: {
                where: { isActive: true },
                include: {
                  sessionKeys: {
                    where: { isActive: true }
                  }
                }
              }
            }
          }
        }
      });

      logger.info(`📊 Found ${activeStrategies.length} active strategies to evaluate`);

      for (const strategy of activeStrategies) {
        try {
          await this.evaluateAndExecuteStrategy(strategy);
        } catch (error) {
          logger.error(`❌ Error executing strategy ${strategy.id}:`, error);
          await this.updateStrategyStatus(strategy.id, 'FAILED', error instanceof Error ? error.message : 'Unknown error');
        }
      }
    } catch (error) {
      logger.error('❌ Error in strategy execution cycle:', error);
    }
  }

  private async evaluateAndExecuteStrategy(strategy: any): Promise<void> {
    const conditions: StrategyCondition[] = JSON.parse(strategy.conditions || '[]');
    const userSession = strategy.user.sessions[0];

    if (!userSession || !userSession.sessionKeys.length) {
      throw new Error('No active session or session keys found for user');
    }
    
    const sessionKey = userSession.sessionKeys[0];

    logger.info(`🔍 Evaluating strategy ${strategy.id} for user ${strategy.userId}`);

    const shouldExecute = await this.evaluateConditions(conditions);
    
    if (!shouldExecute) {
      logger.debug(`⏸️ Conditions not met for strategy ${strategy.id}`);
      return;
    }

    logger.info(`✅ Conditions met for strategy ${strategy.id}, executing...`);

    const executionContext: ExecutionContext = {
      strategyId: strategy.id,
      userId: strategy.userId,
      smartAccountAddress: strategy.user.smartAccountAddress || '',
      sessionKeyAddress: sessionKey.address,
      conditions,
      parameters: this.parseStrategyParameters(strategy.parameters || '{}')
    };

    await this.executeStrategy(executionContext);
  }

  private async evaluateConditions(conditions: StrategyCondition[]): Promise<boolean> {
    for (const condition of conditions) {
      const result = await this.evaluateCondition(condition);
      if (!result) {
        return false;
      }
    }
    return true;
  }

  private async evaluateCondition(condition: StrategyCondition): Promise<boolean> {
    switch (condition.type) {
      case 'price':
        return await this.evaluatePriceCondition(condition);
      case 'time':
        return await this.evaluateTimeCondition(condition);
      case 'volume':
        return await this.evaluateVolumeCondition(condition);
      case 'technical_indicator':
        return await this.evaluateTechnicalIndicatorCondition(condition);
      default:
        logger.warn(`Unknown condition type: ${condition.type}`);
        return false;
    }
  }

  private async evaluatePriceCondition(condition: StrategyCondition): Promise<boolean> {
    if (!condition.tokenAddress) {
      logger.error('Token address required for price condition');
      return false;
    }

    try {
      const currentPrice = await this.blockchainService.getTokenPrice(condition.tokenAddress);
      const targetPrice = parseFloat(condition.value);

      switch (condition.operator) {
        case 'gt':
          return currentPrice > targetPrice;
        case 'lt':
          return currentPrice < targetPrice;
        case 'gte':
          return currentPrice >= targetPrice;
        case 'lte':
          return currentPrice <= targetPrice;
        case 'eq':
          return Math.abs(currentPrice - targetPrice) < 0.001;
        default:
          return false;
      }
    } catch (error) {
      logger.error(`Error evaluating price condition:`, error);
      return false;
    }
  }

  private async evaluateTimeCondition(condition: StrategyCondition): Promise<boolean> {
    const targetTime = new Date(condition.value).getTime();
    const currentTime = Date.now();

    switch (condition.operator) {
      case 'gt':
        return currentTime > targetTime;
      case 'lt':
        return currentTime < targetTime;
      case 'gte':
        return currentTime >= targetTime;
      case 'lte':
        return currentTime <= targetTime;
      case 'eq':
        return Math.abs(currentTime - targetTime) < 60000; // 1 minute tolerance
      default:
        return false;
    }
  }

  private async evaluateVolumeCondition(condition: StrategyCondition): Promise<boolean> {
    if (!condition.tokenAddress) {
      logger.error('Token address required for volume condition');
      return false;
    }

    try {
      const volume24h = await this.blockchainService.getToken24hVolume(condition.tokenAddress);
      const targetVolume = parseFloat(condition.value);

      switch (condition.operator) {
        case 'gt':
          return volume24h > targetVolume;
        case 'lt':
          return volume24h < targetVolume;
        case 'gte':
          return volume24h >= targetVolume;
        case 'lte':
          return volume24h <= targetVolume;
        case 'eq':
          return Math.abs(volume24h - targetVolume) < (targetVolume * 0.01);
        default:
          return false;
      }
    } catch (error) {
      logger.error(`Error evaluating volume condition:`, error);
      return false;
    }
  }

  private async evaluateTechnicalIndicatorCondition(condition: StrategyCondition): Promise<boolean> {
    // Implementation for technical indicators (RSI, MACD, etc.)
    logger.warn('Technical indicator conditions not yet implemented');
    return false;
  }

  private parseStrategyParameters(config: string): StrategyParameters {
    try {
      const parsed = JSON.parse(config);
      return {
        tokenIn: parsed.tokenIn || ethers.ZeroAddress,
        tokenOut: parsed.tokenOut || ethers.ZeroAddress,
        amountIn: parsed.amountIn || '0',
        minAmountOut: parsed.minAmountOut || '0',
        slippage: parsed.slippage || 0.5,
        dexRouter: parsed.dexRouter || '',
        gasLimit: parsed.gasLimit || '500000',
        maxGasPrice: parsed.maxGasPrice || '20000000000'
      };
    } catch (error) {
      logger.error('Error parsing strategy parameters:', error);
      throw new Error('Invalid strategy configuration');
    }
  }

  private async executeStrategy(context: ExecutionContext): Promise<void> {
    try {
      await this.updateStrategyStatus(context.strategyId, 'EXECUTING');

      // Get active session key for the user
      const sessionKey = await this.getActiveSessionKey(context.userId);
      if (!sessionKey) {
        throw new Error('No active session key found for user');
      }

      context.sessionKeyAddress = sessionKey.address;

      // Execute the swap through the smart account
      const txHash = await this.blockchainService.executeSmartAccountTransaction({
        smartAccountAddress: context.smartAccountAddress,
        sessionKeyAddress: context.sessionKeyAddress,
        targetContract: context.parameters.dexRouter,
        callData: await this.buildSwapCallData(context.parameters),
        value: '0'
      });

      // Record the transaction
      await this.prisma.transaction.create({
        data: {
          txHash: txHash,
          userId: context.userId,
          strategyId: context.strategyId,
          type: 'SWAP',
          status: 'PENDING',
          tokensIn: {
            token: context.parameters.tokenIn,
            amount: context.parameters.amountIn
          },
          tokensOut: {
            token: context.parameters.tokenOut,
            amount: context.parameters.minAmountOut
          }
        }
      });

      await this.updateStrategyStatus(context.strategyId, 'COMPLETED');
      
      logger.info(`✅ Strategy ${context.strategyId} executed successfully. Tx: ${txHash}`);

    } catch (error) {
      logger.error(`❌ Strategy execution failed for ${context.strategyId}:`, error);
      await this.updateStrategyStatus(context.strategyId, 'FAILED', error instanceof Error ? error.message : 'Execution failed');
      throw error;
    }
  }

  private async getActiveSessionKey(userId: string): Promise<any> {
    const userSession = await this.prisma.userSession.findFirst({
      where: {
        userId,
        isActive: true,
        expiresAt: {
          gt: new Date()
        }
      },
      include: {
        sessionKeys: {
          where: {
            isActive: true,
            validUntil: {
              gt: new Date()
            }
          }
        }
      }
    });
    
    return userSession?.sessionKeys?.[0] || null;
  }

  private async buildSwapCallData(parameters: StrategyParameters): Promise<string> {
    // Build the swap call data based on DEX router interface
    const iface = new ethers.Interface([
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
    ]);

    const path = [parameters.tokenIn, parameters.tokenOut];
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    return iface.encodeFunctionData('swapExactTokensForTokens', [
      parameters.amountIn,
      parameters.minAmountOut,
      path,
      parameters.tokenIn, // Smart account address will be filled by blockchain service
      deadline
    ]);
  }

  private async updateStrategyStatus(strategyId: string, status: string, error?: string): Promise<void> {
    const updateData: any = {
      updatedAt: new Date()
    };

    if (status === 'COMPLETED') {
      updateData.lastExecutedAt = new Date();
      updateData.executedCount = { increment: 1 };
    }

    if (status === 'FAILED') {
      updateData.isActive = false; // Disable failed strategies
    }

    await this.prisma.strategy.update({
      where: { id: strategyId },
      data: updateData
    });
    
    logger.info(`📊 Strategy ${strategyId} status updated to ${status}`);
  }

  async getStrategyStats(): Promise<any> {
    const [totalStrategies, activeStrategies, executedStrategies] = await Promise.all([
      this.prisma.strategy.count(),
      this.prisma.strategy.count({ where: { isActive: true } }),
      this.prisma.strategy.count({ where: { executedCount: { gt: 0 } } })
    ]);

    return {
      totalStrategies,
      activeStrategies,
      executedStrategies,
      isEngineRunning: this.isRunning
    };
  }
}