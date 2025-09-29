import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import { RealBlockchainService } from './RealBlockchainService';
import { ethers } from 'ethers';

export interface StrategyCondition {
  type: 'price' | 'time' | 'volume' | 'technical_indicator';
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  indicator?: string;
  metadata?: Record<string, any>;
  normalized?: boolean;
  sourceType?: string;
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
  private tokenSymbolCache: Map<string, { address: string; symbol?: string; name?: string }>
    = new Map();
  private tokenAddressCache: Map<string, { address: string; symbol?: string; name?: string }>
    = new Map();

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
    const rawConditions = strategy.conditions || '[]';
    const parsedConditions: any[] = typeof rawConditions === 'string'
      ? JSON.parse(rawConditions)
      : rawConditions;

    const conditions = await this.normalizeConditions(strategy, parsedConditions);

    strategy.conditions = conditions;

    if (!conditions.length) {
      logger.warn(`Strategy ${strategy.id} has no valid conditions after normalization; marking as failed.`);
      await this.updateStrategyStatus(strategy.id, 'FAILED', 'No valid conditions');
      return;
    }

    const userSession = strategy.user.sessions[0];

    if (!userSession || !userSession.sessionKeys.length) {
      throw new Error('No active session or session keys found for user');
    }
    
    const sessionKey = userSession.sessionKeys[0];

    logger.info(`🔍 Evaluating strategy ${strategy.id} for user ${strategy.userId}`);

    const shouldExecute = await this.evaluateConditions(strategy, conditions);
    
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

  private async normalizeConditions(strategy: any, rawConditions: any[]): Promise<StrategyCondition[]> {
    const normalized: StrategyCondition[] = [];
    let needsPersist = false;

    for (const rawCondition of rawConditions) {
      const canonical = await this.normalizeCondition(rawCondition);

      if (!canonical) {
        needsPersist = true;
        logger.warn(`Skipping unsupported condition in strategy ${strategy.id}: ${JSON.stringify(rawCondition)}`);
        continue;
      }

      if (!rawCondition?.normalized) {
        needsPersist = true;
      }

      normalized.push(canonical);
    }

    if (needsPersist) {
      try {
        const serializableConditions = normalized.map(condition => ({ ...condition }));
        await this.prisma.strategy.update({
          where: { id: strategy.id },
          data: { conditions: serializableConditions as Prisma.JsonArray }
        });
      } catch (error) {
        logger.error(`Failed to persist normalized conditions for strategy ${strategy.id}:`, error);
      }
    }

    return normalized;
  }

  private async normalizeCondition(condition: any): Promise<StrategyCondition | null> {
    if (!condition || typeof condition !== 'object') {
      return null;
    }

    if (condition.normalized === true) {
      if (condition.tokenAddress && condition.tokenSymbol) {
        this.cacheTokenInfo({ address: condition.tokenAddress, symbol: condition.tokenSymbol });
      }
      return condition as StrategyCondition;
    }

    const rawType = typeof condition.type === 'string' ? condition.type.toLowerCase() : '';

    switch (rawType) {
      case 'price_below':
      case 'price_above': {
        const operator = rawType === 'price_below' ? 'lt' : 'gt';
        const tokenInfo = await this.resolveTokenInfo(condition.tokenAddress, condition.token || condition.tokenSymbol);

        if (!tokenInfo) {
          logger.error(`Unable to resolve token for price condition: ${JSON.stringify(condition)}`);
          return null;
        }

        this.cacheTokenInfo(tokenInfo);

        return {
          type: 'price',
          operator,
          value: String(condition.value ?? '0'),
          tokenAddress: tokenInfo.address,
          tokenSymbol: tokenInfo.symbol,
          metadata: {
            ...(condition.metadata || {}),
            sourceType: rawType
          },
          normalized: true
        };
      }
      case 'time_after':
      case 'time_before': {
        const schedule = this.parseTimeCondition(condition.value, rawType === 'time_before');

        if (!schedule) {
          logger.error(`Unable to parse time condition: ${JSON.stringify(condition)}`);
          return null;
        }

        return {
          type: 'time',
          operator: schedule.operator,
          value: schedule.timeValue,
          metadata: {
            ...(condition.metadata || {}),
            ...schedule.metadata,
            sourceType: rawType
          },
          normalized: true
        };
      }
      case 'price':
      case 'time':
      case 'volume':
      case 'technical_indicator': {
        const tokenSymbol = condition.tokenSymbol || condition.token;
        const baseCondition: StrategyCondition = {
          type: rawType as StrategyCondition['type'],
          operator: this.normalizeOperator(condition.operator),
          value: String(condition.value ?? ''),
          tokenAddress: condition.tokenAddress,
          tokenSymbol: tokenSymbol ? String(tokenSymbol).toUpperCase() : undefined,
          indicator: condition.indicator,
          metadata: {
            ...(condition.metadata || {}),
            sourceType: condition.sourceType || rawType
          },
          normalized: true
        };

        if (baseCondition.tokenAddress) {
          this.cacheTokenInfo({ address: baseCondition.tokenAddress, symbol: baseCondition.tokenSymbol });
        }

        return baseCondition;
      }
      default:
        return null;
    }
  }

  private normalizeOperator(operator: string | undefined): StrategyCondition['operator'] {
    switch ((operator || '').toLowerCase()) {
      case 'gt':
      case '>':
        return 'gt';
      case 'lt':
      case '<':
        return 'lt';
      case 'gte':
      case '>=':
      case 'after':
        return 'gte';
      case 'lte':
      case '<=':
      case 'before':
        return 'lte';
      case 'eq':
      case '==':
        return 'eq';
      default:
        return 'eq';
    }
  }

  private parseTimeCondition(value: any, isBefore: boolean): { timeValue: string; operator: StrategyCondition['operator']; metadata: Record<string, any> } | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const raw = value.trim();
    const lower = raw.toLowerCase();
    const dailyMatch = /^([0-2]\d:[0-5]\d)$/.exec(lower);
    const weeklyMatch = /^([a-z]+)_([0-2]\d:[0-5]\d)$/.exec(lower);

    if (weeklyMatch) {
      const dayName = weeklyMatch[1];
      const timeOfDay = weeklyMatch[2];
      const dayIndex = this.dayNameToIndex(dayName);

      if (dayIndex === null) {
        return null;
      }

      return {
        timeValue: timeOfDay,
        operator: isBefore ? 'lte' : 'gte',
        metadata: {
          schedule: 'weekly',
          dayOfWeek: dayIndex,
          timeOfDay
        }
      };
    }

    if (dailyMatch) {
      const timeOfDay = dailyMatch[1];
      return {
        timeValue: timeOfDay,
        operator: isBefore ? 'lte' : 'gte',
        metadata: {
          schedule: 'daily',
          timeOfDay
        }
      };
    }

    const timestamp = Date.parse(raw);
    if (!Number.isNaN(timestamp)) {
      return {
        timeValue: new Date(timestamp).toISOString(),
        operator: isBefore ? 'lte' : 'gte',
        metadata: {
          schedule: 'absolute'
        }
      };
    }

    return null;
  }

  private dayNameToIndex(dayName: string): number | null {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const index = days.indexOf(dayName.toLowerCase());
    return index === -1 ? null : index;
  }

  private cacheTokenInfo(info: { address: string; symbol?: string | null; name?: string | null }) {
    if (!info.address) {
      return;
    }

    const normalizedAddress = info.address.toLowerCase();
    const normalizedSymbol = info.symbol ? info.symbol.toUpperCase() : undefined;
    this.tokenAddressCache.set(normalizedAddress, {
      address: info.address,
      symbol: normalizedSymbol,
      name: info.name ?? undefined
    });

    if (normalizedSymbol) {
      const symbolKey = normalizedSymbol;
      this.tokenSymbolCache.set(symbolKey, {
        address: info.address,
        symbol: normalizedSymbol,
        name: info.name ?? undefined
      });

      this.blockchainService.registerTokenMetadata(info.address, normalizedSymbol);
    }
  }

  private async resolveTokenInfo(address?: string, symbol?: string): Promise<{ address: string; symbol?: string; name?: string } | null> {
    if (address && typeof address === 'string' && this.isValidAddress(address)) {
      const normalized = address.toLowerCase();
      const cached = this.tokenAddressCache.get(normalized);
      if (cached) {
        return cached;
      }

      const token = await this.prisma.tokenRegistry.findUnique({ where: { address } });
      const info = token
        ? { address: token.address, symbol: token.symbol || undefined, name: token.name || undefined }
        : { address };
      this.cacheTokenInfo(info);
      return info;
    }

    if (symbol && typeof symbol === 'string') {
      const normalizedSymbol = symbol.toUpperCase();
      const cached = this.tokenSymbolCache.get(normalizedSymbol);
      if (cached) {
        return cached;
      }

       const aliasAddress = this.resolveSymbolAlias(normalizedSymbol);
       if (aliasAddress) {
         const aliasInfo = { address: aliasAddress, symbol: normalizedSymbol };
         this.cacheTokenInfo(aliasInfo);
         return aliasInfo;
       }

      const token = await this.prisma.tokenRegistry.findFirst({
        where: {
          symbol: {
            equals: symbol,
            mode: 'insensitive'
          },
          isActive: true
        }
      });

      if (!token) {
        return null;
      }

      const info = { address: token.address, symbol: token.symbol || normalizedSymbol, name: token.name || undefined };
      this.cacheTokenInfo(info);
      return info;
    }

    return null;
  }

  private resolveSymbolAlias(symbol: string): string | null {
    switch (symbol) {
      case 'SEI':
        return ethers.ZeroAddress;
      default:
        return null;
    }
  }

  private isValidAddress(address: string): boolean {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  }

  private async evaluateConditions(strategy: any, conditions: StrategyCondition[]): Promise<boolean> {
    for (const condition of conditions) {
      const result = await this.evaluateCondition(strategy, condition);
      if (!result) {
        return false;
      }
    }
    return true;
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
    try {
      const parsed = typeof config === 'string' ? JSON.parse(config) : config || {};
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
