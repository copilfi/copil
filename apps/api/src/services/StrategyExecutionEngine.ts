import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { RealBlockchainService } from './RealBlockchainService';
import { ethers } from 'ethers';
import env from '@/config/env';
import {
  createConditionCache,
  normalizeStrategyConditions,
  StrategyCondition
} from '@/utils/strategyConditionNormalizer';
import {
  AutomationSessionService,
  DEFAULT_AUTOMATION_FUNCTION_SELECTORS
} from './AutomationSessionService';

export interface StrategyParameters {
  tokenIn: string;
  tokenInDecimals: number;
  tokenOut: string;
  tokenOutDecimals: number;
  amountIn: string;
  minAmountOut: string;
  slippage: number;
  dexRouter: string;
  gasLimit: string;
  maxGasPrice: string;
  protocol?: string;
  frequencySeconds?: number;
  maxExecutions?: number;
  startAt?: string;
  priceTarget?: number;
  timeDeadline?: string;
}

export interface ExecutionContext {
  strategyId: string;
  userId: string;
  smartAccountAddress: string;
  userWalletAddress?: string;
  sessionKeyAddress: string;
  conditions: StrategyCondition[];
  parameters: StrategyParameters;
}

export class StrategyExecutionEngine {
  private prisma: PrismaClient;
  private blockchainService: RealBlockchainService;
  private isRunning: boolean = false;
  private executionInterval: NodeJS.Timeout | null = null;
  private conditionCache = createConditionCache();
  private automationSessionService: AutomationSessionService;

  constructor(
    prisma: PrismaClient,
    blockchainService: RealBlockchainService,
    automationSessionService?: AutomationSessionService
  ) {
    this.prisma = prisma;
    this.blockchainService = blockchainService;
    this.automationSessionService = automationSessionService
      ? automationSessionService
      : new AutomationSessionService(prisma, blockchainService);
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
            select: {
              id: true,
              smartAccountAddress: true,
              walletAddress: true
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
    const rawConditions = strategy.conditions || '[]';
    const parsedConditions: any[] = typeof rawConditions === 'string'
      ? JSON.parse(rawConditions)
      : rawConditions;

    const conditions = await this.normalizeConditions(strategy, parsedConditions);
    const parameters = this.parseStrategyParameters(strategy.parameters || '{}');

    strategy.conditions = conditions;

    const shouldExecute = await this.evaluateConditions(strategy, conditions, parameters);

    if (!shouldExecute) {
      logger.debug(`⏸️ Conditions not met for strategy ${strategy.id}`);
      return;
    }

    logger.info(`✅ Conditions met for strategy ${strategy.id}, executing...`);

    const executionContext: ExecutionContext = {
      strategyId: strategy.id,
      userId: strategy.userId,
      smartAccountAddress: strategy.user.smartAccountAddress || '',
      userWalletAddress: strategy.user.walletAddress || undefined,
      sessionKeyAddress: '',
      conditions,
      parameters
    };

    await this.executeStrategy(executionContext);
  }

  private async normalizeConditions(strategy: any, rawConditions: any[]): Promise<StrategyCondition[]> {
    const { normalized, changed, skipped } = await normalizeStrategyConditions(
      strategy.id,
      rawConditions,
      {
        prisma: this.prisma,
        blockchainService: this.blockchainService,
        cache: this.conditionCache
      }
    );

    if (skipped > 0) {
      logger.warn(`Strategy ${strategy.id}: skipped ${skipped} unsupported condition${skipped > 1 ? 's' : ''}.`);
    }

    if (changed) {
      try {
        await this.prisma.strategy.update({
          where: { id: strategy.id },
          data: { conditions: normalized as unknown as Prisma.JsonArray }
        });
      } catch (error) {
        logger.error(`Failed to persist normalized conditions for strategy ${strategy.id}:`, error);
      }
    }

    return normalized;
  }

  private async evaluateConditions(strategy: any, conditions: StrategyCondition[], parameters: StrategyParameters): Promise<boolean> {
    if (strategy.type === 'DCA') {
      return this.evaluateDcaSchedule(strategy, parameters);
    }

    if (!conditions.length) {
      logger.warn(`Strategy ${strategy.id} has no valid conditions after normalization; marking as failed.`);
      await this.updateStrategyStatus(strategy.id, 'FAILED', 'No valid conditions');
      return false;
    }

    for (const condition of conditions) {
      const result = await this.evaluateCondition(strategy, condition);
      if (!result) {
        return false;
      }
    }
    return true;
  }

  private evaluateDcaSchedule(strategy: any, parameters: StrategyParameters): boolean {
    if (!parameters.frequencySeconds || parameters.frequencySeconds <= 0) {
      logger.warn(`DCA strategy ${strategy.id} missing frequencySeconds parameter`);
      return false;
    }

    if (parameters.maxExecutions && strategy.executedCount >= parameters.maxExecutions) {
      logger.info(`DCA strategy ${strategy.id} reached max executions (${parameters.maxExecutions})`);
      return false;
    }

    const now = Date.now();
    const startAt = parameters.startAt ? Date.parse(parameters.startAt) : strategy.createdAt ? new Date(strategy.createdAt).getTime() : now;
    const lastExecutedAt = strategy.lastExecutedAt ? new Date(strategy.lastExecutedAt).getTime() : null;
    const nextAllowed = lastExecutedAt ? lastExecutedAt + parameters.frequencySeconds * 1000 : startAt;

    if (!Number.isFinite(nextAllowed)) {
      return false;
    }

    return now >= nextAllowed;
  }

  private async evaluateCondition(strategy: any, condition: StrategyCondition): Promise<boolean> {
    switch (condition.type) {
      case 'price':
        return await this.evaluatePriceCondition(condition);
      case 'time':
        return await this.evaluateTimeCondition(strategy, condition);
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
      const targetPrice = parseFloat(condition.value);
      if (Number.isNaN(targetPrice)) {
        logger.error(`Invalid target price for condition: ${condition.value}`);
        return false;
      }

      const currentPrice = await this.blockchainService.getTokenPrice(
        condition.tokenAddress,
        condition.tokenSymbol
      );

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
          return Math.abs(currentPrice - targetPrice) < Math.max(targetPrice * 0.001, 0.001);
        default:
          return false;
      }
    } catch (error) {
      logger.error(`Error evaluating price condition:`, error);
      return false;
    }
  }

  private async evaluateTimeCondition(strategy: any, condition: StrategyCondition): Promise<boolean> {
    const schedule = condition.metadata?.schedule;

    if (schedule === 'daily' || schedule === 'weekly') {
      return this.evaluateScheduledTimeCondition(strategy, condition, schedule);
    }

    const targetTime = new Date(condition.value).getTime();
    if (Number.isNaN(targetTime)) {
      logger.error(`Invalid time condition value: ${condition.value}`);
      return false;
    }

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

  private evaluateScheduledTimeCondition(
    strategy: any,
    condition: StrategyCondition,
    schedule: 'daily' | 'weekly'
  ): boolean {
    const timeOfDay: string | undefined = condition.metadata?.timeOfDay;
    if (!timeOfDay) {
      logger.error('Scheduled time condition missing timeOfDay metadata');
      return false;
    }

    const [hours, minutes] = timeOfDay.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      logger.error(`Invalid timeOfDay metadata for condition: ${timeOfDay}`);
      return false;
    }

    const now = new Date();

    if (schedule === 'weekly') {
      const dayOfWeek = condition.metadata?.dayOfWeek;
      if (typeof dayOfWeek !== 'number') {
        logger.error('Weekly time condition missing dayOfWeek metadata');
        return false;
      }

      if (now.getDay() !== dayOfWeek) {
        return false;
      }
    }

    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);

    const lastExecutedAt = strategy.lastExecutedAt ? new Date(strategy.lastExecutedAt) : null;
    const operator = condition.operator;

    if (operator === 'lte') {
      if (now.getTime() > target.getTime()) {
        return false;
      }

      if (!lastExecutedAt) {
        return true;
      }

      if (this.isSameDay(lastExecutedAt, target)) {
        return false;
      }

      return true;
    }

    if (now.getTime() < target.getTime()) {
      return false;
    }

    if (!lastExecutedAt) {
      return true;
    }

    if (this.isSameDay(lastExecutedAt, target)) {
      return false;
    }

    return true;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getUTCFullYear() === b.getUTCFullYear()
      && a.getUTCMonth() === b.getUTCMonth()
      && a.getUTCDate() === b.getUTCDate();
  }

  private async evaluateVolumeCondition(condition: StrategyCondition): Promise<boolean> {
    if (!condition.tokenAddress) {
      logger.error('Token address required for volume condition');
      return false;
    }

    try {
      const volume24h = await this.blockchainService.getToken24hVolume(
        condition.tokenAddress,
        condition.tokenSymbol
      );
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

  private parseStrategyParameters(config: string | Record<string, unknown>): StrategyParameters {
    const extractAddress = (value: unknown): string => {
      if (typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)) {
        return value;
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const address = obj.address;
        if (typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address)) {
          return address;
        }
      }
      return ethers.ZeroAddress;
    };

    const extractNumber = (value: unknown): number => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return 0;
    };

    const toStringValue = (value: unknown): string => {
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'number') {
        return value.toString();
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return '0';
    };

    try {
      const parsed = typeof config === 'string' ? JSON.parse(config) : (config || {});

      const tokenInTarget = parsed.tokenIn ?? parsed.inputToken;
      const tokenOutTarget = parsed.tokenOut ?? parsed.outputToken;

      const tokenInAddress = extractAddress(tokenInTarget);
      const tokenOutAddress = extractAddress(tokenOutTarget);

      const tokenInDecimals = typeof tokenInTarget?.decimals === 'number' ? tokenInTarget.decimals : 18;
      const tokenOutDecimals = typeof tokenOutTarget?.decimals === 'number' ? tokenOutTarget.decimals : 18;

      const amountInRaw = parsed.amountInWei ?? parsed.amountIn ?? parsed.amountPerExecutionWei ?? parsed.amountPerExecution;
      const minAmountOutRaw = parsed.minAmountOutWei ?? parsed.minAmountOut ?? parsed.amountOutMinWei ?? parsed.amountOutMin;

      const frequencySeconds = extractNumber(parsed.frequencySeconds ?? parsed.frequency ?? parsed.intervalSeconds);
      const maxExecutions = extractNumber(parsed.maxExecutions);

      return {
        tokenIn: tokenInAddress,
        tokenInDecimals,
        tokenOut: tokenOutAddress,
        tokenOutDecimals,
        amountIn: toStringValue(amountInRaw),
        minAmountOut: toStringValue(minAmountOutRaw),
        slippage: typeof parsed.slippage === 'number' ? parsed.slippage : extractNumber(parsed.slippage) || 0.5,
        dexRouter: typeof parsed.dexRouter === 'string' && parsed.dexRouter ? parsed.dexRouter : env.DEFAULT_DEX_ROUTER_ADDRESS || '',
        gasLimit: toStringValue(parsed.gasLimit ?? '500000'),
        maxGasPrice: toStringValue(parsed.maxGasPrice ?? '20000000000'),
        protocol: typeof parsed.protocol === 'string' ? parsed.protocol : undefined,
        frequencySeconds: frequencySeconds > 0 ? frequencySeconds : undefined,
        maxExecutions: maxExecutions > 0 ? maxExecutions : undefined,
        startAt: typeof parsed.startAt === 'string' ? parsed.startAt : undefined,
        priceTarget: Number.isFinite(parsed.priceTarget) ? Number(parsed.priceTarget) : undefined,
        timeDeadline: typeof parsed.timeDeadline === 'string' ? parsed.timeDeadline : undefined
      };
    } catch (error) {
      logger.error('Error parsing strategy parameters:', error);
      throw new Error('Invalid strategy configuration');
    }
  }

  private async executeStrategy(context: ExecutionContext): Promise<void> {
    try {
      await this.updateStrategyStatus(context.strategyId, 'EXECUTING');

      if (!context.smartAccountAddress && context.userWalletAddress) {
        try {
          const resolved = await this.blockchainService.getSmartAccountAddress(context.userWalletAddress);
          if (resolved) {
            context.smartAccountAddress = resolved;
          }
        } catch (error) {
          logger.warn(`Unable to resolve smart account address on-chain for user ${context.userId}:`, error);
        }
      }

      if (!context.smartAccountAddress || !ethers.isAddress(context.smartAccountAddress)) {
        throw new Error('Smart account address not available for strategy execution');
      }

      if (!context.parameters.dexRouter || !ethers.isAddress(context.parameters.dexRouter)) {
        throw new Error('DEX router address missing or invalid for strategy execution');
      }

      if (!ethers.isAddress(context.parameters.tokenIn) || !ethers.isAddress(context.parameters.tokenOut)) {
        throw new Error('Strategy tokens are not configured with valid addresses');
      }

      // Get active session key for the user
    if (!context.userWalletAddress) {
      throw new Error('User wallet address not available for strategy execution');
    }

    const sessionKey = await this.automationSessionService.ensureSessionKey({
      userId: context.userId,
      userWalletAddress: context.userWalletAddress,
      smartAccountAddress: context.smartAccountAddress,
      targetContracts: [context.parameters.dexRouter]
    });

    context.sessionKeyAddress = sessionKey.address;

      // Execute the swap through the smart account
      const txHash = await this.blockchainService.executeSmartAccountTransaction({
        smartAccountAddress: context.smartAccountAddress,
        sessionKeyAddress: context.sessionKeyAddress,
        targetContract: context.parameters.dexRouter,
        callData: await this.buildSwapCallData(context.parameters, context.smartAccountAddress),
        value: '0'
      });

      // Record the transaction
      const amountInFormatted = ethers.formatUnits(context.parameters.amountIn, context.parameters.tokenInDecimals ?? 18);
      const minAmountOutFormatted = ethers.formatUnits(context.parameters.minAmountOut, context.parameters.tokenOutDecimals ?? 18);

      await this.prisma.transaction.create({
        data: {
          txHash: txHash,
          userId: context.userId,
          strategyId: context.strategyId,
          type: 'SWAP',
          status: 'PENDING',
          tokensIn: {
            token: context.parameters.tokenIn,
            amount: context.parameters.amountIn,
            amountFormatted: amountInFormatted
          },
          tokensOut: {
            token: context.parameters.tokenOut,
            amount: context.parameters.minAmountOut,
            amountFormatted: minAmountOutFormatted
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

  private parseAmountToBigInt(value: string): bigint {
    try {
      return BigInt(value);
    } catch {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return BigInt(Math.floor(numeric));
      }
      return 0n;
    }
  }

  private async buildSwapCallData(parameters: StrategyParameters, recipient: string): Promise<string> {
    // Build the swap call data based on DEX router interface
    const iface = new ethers.Interface([
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
    ]);

    const path = [parameters.tokenIn, parameters.tokenOut];
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const amountIn = this.parseAmountToBigInt(parameters.amountIn);
    const minAmountOut = this.parseAmountToBigInt(parameters.minAmountOut);

    return iface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      minAmountOut,
      path,
      recipient,
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
