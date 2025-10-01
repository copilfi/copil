import { Router, Response } from 'express';
import { Prisma, PrismaClient, Strategy, Transaction } from '@prisma/client';
import { ethers } from 'ethers';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler, AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import env from '@/config/env';

const router = Router();
const prisma = new PrismaClient();

interface DCAStrategyRequest {
  tokenFrom: string;
  tokenTo: string;
  totalBudget: number;
  frequency: string | number;
  duration?: number;
  protocol?: 'dragonswap' | 'symphony';
  slippage?: number;
}

interface TokenResolution {
  address?: string;
  symbol?: string;
  name?: string | null;
  decimals?: number | null;
}

interface ParsedDCAParameters {
  tokenIn?: TokenResolution;
  tokenOut?: TokenResolution;
  totalBudget?: number;
  amountPerExecution?: number;
  amountInWei?: string;
  minAmountOutWei?: string;
  frequencySeconds?: number;
  maxExecutions?: number;
  slippage?: number;
  protocol?: string;
  durationSeconds?: number;
  startAt?: string;
  nextExecutionOverride?: string;
  dexRouter?: string;
}

interface DCAStrategyResponse {
  id: string;
  tokenIn: string;
  tokenOut: string;
  totalBudget: number;
  amountPerExecution: number;
  frequency: number;
  maxExecutions: number;
  executedCount: number;
  protocol: string;
  isActive: boolean;
  createdAt: string;
  nextExecutionAt: string;
  lastExecutedAt?: string;
}

interface DCAExecutionResponse {
  id: string;
  strategyId: string;
  executedAt: string;
  amountIn: number;
  amountOut: number;
  price: number;
  txHash: string;
  status: string;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const toPlainObject = (value: Prisma.JsonValue | null | undefined): Record<string, any> => {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) };
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const normalizeTokenRef = (input: unknown): TokenResolution | undefined => {
  if (!input) {
    return undefined;
  }
  if (typeof input === 'string') {
    if (ADDRESS_REGEX.test(input)) {
      return { address: input };
    }
    return { symbol: input };
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, any>;
    const address = typeof obj.address === 'string' ? obj.address : undefined;
    const symbol = typeof obj.symbol === 'string' ? obj.symbol : undefined;
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    const decimals = typeof obj.decimals === 'number' ? obj.decimals : undefined;

    if (address || symbol) {
      return {
        address: address || '',
        symbol,
        name,
        decimals
      };
    }
  }
  return undefined;
};

const parseDCAParameters = (parameters: Prisma.JsonValue | null | undefined): ParsedDCAParameters => {
  const raw = toPlainObject(parameters);
  const tokenIn = normalizeTokenRef(raw.tokenIn ?? raw.tokenFrom);
  const tokenOut = normalizeTokenRef(raw.tokenOut ?? raw.tokenTo);

  const totalBudget = toNumber(raw.totalBudget ?? raw.budget, 0);
  const amountPerExecution = toNumber(raw.amountPerExecution ?? raw.chunkSize, 0);
  const amountInWei = typeof raw.amountInWei === 'string' ? raw.amountInWei : undefined;
  const minAmountOutWei = typeof raw.minAmountOutWei === 'string' ? raw.minAmountOutWei : undefined;
  const frequencySeconds = toNumber(raw.frequency ?? raw.intervalSeconds ?? raw.interval, 0);
  const maxExecutions = toNumber(raw.maxExecutions ?? raw.executionCount, 0);
  const slippage = toNumber(raw.slippage, NaN);
  const durationSeconds = toNumber(raw.duration ?? raw.durationSeconds, 0);
  const startAt = typeof raw.startAt === 'string' ? raw.startAt : undefined;
  const nextExecutionOverride = typeof raw.nextExecutionAt === 'string' ? raw.nextExecutionAt : undefined;
  const protocol = typeof raw.protocol === 'string' ? raw.protocol : undefined;
  const dexRouter = typeof raw.dexRouter === 'string' ? raw.dexRouter : undefined;

  return {
    tokenIn,
    tokenOut,
    totalBudget: totalBudget > 0 ? totalBudget : undefined,
    amountPerExecution: amountPerExecution > 0 ? amountPerExecution : undefined,
    amountInWei,
    minAmountOutWei,
    frequencySeconds: frequencySeconds > 0 ? frequencySeconds : undefined,
    maxExecutions: maxExecutions > 0 ? maxExecutions : undefined,
    slippage: Number.isFinite(slippage) ? slippage : undefined,
    protocol,
    durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
    startAt,
    nextExecutionOverride,
    dexRouter
  };
};

const computeNextExecutionAt = (
  strategy: Strategy,
  params: ParsedDCAParameters
): string => {
  const frequency = params.frequencySeconds;
  const now = Date.now();

  if (frequency && frequency > 0) {
    if (strategy.lastExecutedAt) {
      return new Date(strategy.lastExecutedAt.getTime() + frequency * 1000).toISOString();
    }

    if (params.startAt) {
      const parsedStart = Date.parse(params.startAt);
      if (!Number.isNaN(parsedStart)) {
        return new Date(parsedStart).toISOString();
      }
    }

    return new Date(now + frequency * 1000).toISOString();
  }

  if (params.nextExecutionOverride) {
    return params.nextExecutionOverride;
  }

  if (strategy.lastExecutedAt) {
    return strategy.lastExecutedAt.toISOString();
  }

  return strategy.createdAt.toISOString();
};

const tokenIdentifier = (token?: TokenResolution): string => {
  if (!token) {
    return '';
  }
  if (token.symbol) {
    return token.symbol;
  }
  if (token.address && ADDRESS_REGEX.test(token.address)) {
    return token.address;
  }
  return '';
};

const resolveToken = async (identifier: string, fieldName: string): Promise<TokenResolution> => {
  if (!identifier) {
    throw new AppError(`${fieldName} is required`, 400);
  }

  if (ADDRESS_REGEX.test(identifier)) {
    const token = await prisma.tokenRegistry.findUnique({ where: { address: identifier } });
    if (!token) {
      throw new AppError(`${fieldName} token address not found in registry`, 400);
    }
    return {
      address: token.address,
      symbol: token.symbol || undefined,
      name: token.name,
      decimals: token.decimals
    };
  }

  const token = await prisma.tokenRegistry.findFirst({
    where: {
      symbol: {
        equals: identifier,
        mode: 'insensitive'
      },
      isActive: true
    }
  });

  if (!token) {
    throw new AppError(`${fieldName} token symbol not found in registry`, 400);
  }

  return {
    address: token.address,
    symbol: token.symbol || undefined,
    name: token.name,
    decimals: token.decimals
  };
};

const sumTokenAmount = (value: Prisma.JsonValue | null | undefined): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + sumTokenAmount(item), 0);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, Prisma.JsonValue>;
    if (obj.amountFormatted !== undefined) {
      return sumTokenAmount(obj.amountFormatted);
    }
    if (obj.amount !== undefined) {
      return sumTokenAmount(obj.amount);
    }
    if (obj.value !== undefined) {
      return sumTokenAmount(obj.value);
    }
    return Object.values(obj).reduce<number>((sum, item) => sum + sumTokenAmount(item), 0);
  }
  return 0;
};

const mapStrategyToResponse = (strategy: Strategy): DCAStrategyResponse => {
  const params = parseDCAParameters(strategy.parameters);

  const totalBudget = params.totalBudget ?? 0;
  const frequencySeconds = params.frequencySeconds ?? 0;
  const decimalsIn = params.tokenIn?.decimals ?? 18;
  const decimalsOut = params.tokenOut?.decimals ?? 18;

  let maxExecutions = params.maxExecutions ?? 0;
  if (!maxExecutions && params.durationSeconds && frequencySeconds) {
    maxExecutions = Math.max(1, Math.floor(params.durationSeconds / frequencySeconds));
  }
  if (!maxExecutions && totalBudget > 0) {
    const displayAmount = params.amountPerExecution ?? (params.amountInWei ? Number(ethers.formatUnits(params.amountInWei, decimalsIn)) : 0);
    if (displayAmount > 0) {
      maxExecutions = Math.floor(totalBudget / displayAmount);
    }
  }

  const amountInWei = params.amountInWei ?? (params.amountPerExecution ? ethers.parseUnits(params.amountPerExecution.toString(), decimalsIn).toString() : '0');
  const amountPerExecution = parseFloat(ethers.formatUnits(amountInWei, decimalsIn));

  const nextExecutionAt = computeNextExecutionAt(strategy, params);

  return {
    id: strategy.id,
    tokenIn: tokenIdentifier(params.tokenIn),
    tokenOut: tokenIdentifier(params.tokenOut),
    totalBudget,
    amountPerExecution,
    frequency: frequencySeconds,
    maxExecutions,
    executedCount: strategy.executedCount ?? 0,
    protocol: params.protocol || 'unknown',
    isActive: strategy.isActive,
    createdAt: strategy.createdAt.toISOString(),
    nextExecutionAt,
    lastExecutedAt: strategy.lastExecutedAt ? strategy.lastExecutedAt.toISOString() : undefined
  };
};

const mapTransactionToExecution = (transaction: Transaction): DCAExecutionResponse => {
  const amountIn = sumTokenAmount(transaction.tokensIn);
  const amountOut = sumTokenAmount(transaction.tokensOut);
  const price = amountIn > 0 ? amountOut / amountIn : 0;

  return {
    id: transaction.id,
    strategyId: transaction.strategyId || 'unknown',
    executedAt: transaction.executedAt.toISOString(),
    amountIn,
    amountOut,
    price,
    txHash: transaction.txHash,
    status: transaction.status
  };
};

router.get('/strategies', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const strategies = await prisma.strategy.findMany({
    where: {
      userId: req.user.id,
      type: 'DCA'
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  const response = strategies.map(mapStrategyToResponse);

  logger.info(`📊 Retrieved ${response.length} DCA strategies for user ${req.user.id}`);

  res.json({
    success: true,
    data: response
  });
}));

router.post('/strategies', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const {
    tokenFrom,
    tokenTo,
    totalBudget,
    frequency,
    duration,
    protocol = 'dragonswap',
    slippage = 1.0
  }: DCAStrategyRequest = req.body;

  if (!tokenFrom || !tokenTo || !totalBudget || !frequency) {
    throw new AppError('Missing required fields: tokenFrom, tokenTo, totalBudget, frequency', 400);
  }

  const totalBudgetNumber = toNumber(totalBudget, 0);
  if (totalBudgetNumber <= 0) {
    throw new AppError('Total budget must be greater than 0', 400);
  }

  const frequencySeconds = toNumber(frequency, 0);
  if (frequencySeconds <= 0) {
    throw new AppError('Frequency must be a positive number of seconds', 400);
  }

  const durationSeconds = duration ? toNumber(duration, 0) : 0;

  const [tokenIn, tokenOut] = await Promise.all([
    resolveToken(tokenFrom, 'tokenFrom'),
    resolveToken(tokenTo, 'tokenTo')
  ]);

  const dexStatus = await prisma.dEXStatus.findFirst({
    where: {
      name: protocol,
      isActive: true
    }
  });

  const dexRouterAddressRaw = dexStatus?.routerAddress || env.DEFAULT_DEX_ROUTER_ADDRESS;
  const dexRouterAddress = dexRouterAddressRaw?.toLowerCase();
  if (!dexRouterAddress || !ADDRESS_REGEX.test(dexRouterAddress)) {
    throw new AppError('No active DEX router configured for selected protocol', 400);
  }

  let maxExecutions = durationSeconds > 0 ? Math.max(1, Math.floor(durationSeconds / frequencySeconds)) : 10;
  if (maxExecutions <= 0) {
    maxExecutions = 1;
  }

  let amountPerExecution = totalBudgetNumber / maxExecutions;
  if (!Number.isFinite(amountPerExecution) || amountPerExecution <= 0) {
    amountPerExecution = totalBudgetNumber;
  }

  const decimalsIn = tokenIn.decimals ?? 18;
  const decimalsOut = tokenOut.decimals ?? 18;
  const amountPerExecutionWei = ethers.parseUnits(amountPerExecution.toString(), decimalsIn).toString();
  const slippageFactor = Math.max(0, 1 - (slippage / 100));
  const minAmountOutDecimal = amountPerExecution * slippageFactor;
  const minAmountOutWei = ethers.parseUnits(minAmountOutDecimal.toString(), decimalsOut).toString();

  const parameters = {
    tokenIn: {
      address: tokenIn.address || null,
      symbol: tokenIn.symbol || null,
      name: tokenIn.name || null,
      decimals: tokenIn.decimals ?? null
    },
    tokenOut: {
      address: tokenOut.address || null,
      symbol: tokenOut.symbol || null,
      name: tokenOut.name || null,
      decimals: tokenOut.decimals ?? null
    },
    totalBudget: totalBudgetNumber,
    amountPerExecution,
    amountInWei: amountPerExecutionWei,
    minAmountOutWei,
    frequencySeconds,
    maxExecutions,
    slippage,
    protocol,
    dexRouter: dexRouterAddress,
    durationSeconds: durationSeconds > 0 ? durationSeconds : null,
    startAt: new Date().toISOString()
  };

  const strategy = await prisma.strategy.create({
    data: {
      userId: req.user.id,
      name: `DCA ${tokenIn.symbol || tokenIn.address} → ${tokenOut.symbol || tokenOut.address}`,
      type: 'DCA',
      description: 'Dollar-cost averaging strategy',
      conditions: [],
      parameters,
      isActive: false // Activated once execution pipeline is ready
    }
  });

  logger.info(`🆕 Created DCA strategy ${strategy.id} for user ${req.user.id}`);

  res.status(201).json({
    success: true,
    data: mapStrategyToResponse(strategy)
  });
}));

router.get('/strategies/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const strategy = await prisma.strategy.findFirst({
    where: {
      id,
      userId: req.user.id,
      type: 'DCA'
    }
  });

  if (!strategy) {
    throw new AppError('Strategy not found', 404);
  }

  res.json({
    success: true,
    data: mapStrategyToResponse(strategy)
  });
}));

router.put('/strategies/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;
  const { isActive, slippage } = req.body as { isActive?: boolean; slippage?: number };

  const strategy = await prisma.strategy.findFirst({
    where: {
      id,
      userId: req.user.id,
      type: 'DCA'
    }
  });

  if (!strategy) {
    throw new AppError('Strategy not found', 404);
  }

  const updatedParameters = toPlainObject(strategy.parameters);
  if (slippage !== undefined) {
    updatedParameters.slippage = toNumber(slippage, updatedParameters.slippage ?? 0);
  }

  await prisma.strategy.update({
    where: { id: strategy.id },
    data: {
      isActive: typeof isActive === 'boolean' ? isActive : strategy.isActive,
      parameters: updatedParameters
    }
  });

  logger.info(`🔄 Updated DCA strategy ${id} for user ${req.user.id}`);

  res.json({
    success: true,
    message: 'DCA strategy updated successfully'
  });
}));

router.delete('/strategies/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const result = await prisma.strategy.deleteMany({
    where: {
      id,
      userId: req.user.id,
      type: 'DCA'
    }
  });

  if (result.count === 0) {
    throw new AppError('Strategy not found', 404);
  }

  logger.info(`🗑️ Deleted DCA strategy ${id} for user ${req.user.id}`);

  res.json({
    success: true,
    message: 'DCA strategy deleted successfully'
  });
}));

router.get('/strategies/:id/executions', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const strategy = await prisma.strategy.findFirst({
    where: {
      id,
      userId: req.user.id,
      type: 'DCA'
    }
  });

  if (!strategy) {
    throw new AppError('Strategy not found', 404);
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: req.user.id,
      strategyId: id
    },
    orderBy: {
      executedAt: 'desc'
    }
  });

  const executions = transactions.map(mapTransactionToExecution);

  res.json({
    success: true,
    data: executions
  });
}));

router.get('/performance', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const strategies = await prisma.strategy.findMany({
    where: {
      userId: req.user.id,
      type: 'DCA'
    },
    include: {
      transactions: true
    }
  });

  const strategySummaries = strategies.map(mapStrategyToResponse);

  const totalInvested = strategies.reduce<number>((sum, strategy) => {
    const strategySum = strategy.transactions.reduce<number>((acc, tx) => acc + sumTokenAmount(tx.tokensIn), 0);
    return sum + strategySum;
  }, 0);

  const currentValue = strategies.reduce<number>((sum, strategy) => {
    const strategySum = strategy.transactions.reduce<number>((acc, tx) => acc + sumTokenAmount(tx.tokensOut), 0);
    return sum + strategySum;
  }, 0);

  const executionPrices = strategies.flatMap(strategy =>
    strategy.transactions
      .map(tx => {
        const amountIn = sumTokenAmount(tx.tokensIn);
        const amountOut = sumTokenAmount(tx.tokensOut);
        return amountIn > 0 ? amountOut / amountIn : null;
      })
      .filter((price): price is number => price !== null)
  );

  const avgExecutionPrice = executionPrices.length
    ? executionPrices.reduce((sum, price) => sum + price, 0) / executionPrices.length
    : 0;

  const nextExecution = strategySummaries
    .map(summary => Date.parse(summary.nextExecutionAt))
    .filter(timestamp => !Number.isNaN(timestamp) && timestamp >= Date.now())
    .sort((a, b) => a - b)[0];

  res.json({
    success: true,
    data: {
      totalStrategies: strategySummaries.length,
      activeStrategies: strategySummaries.filter(strategy => strategy.isActive).length,
      totalInvested,
      currentValue,
      totalPnL: currentValue - totalInvested,
      totalPnLPercentage: totalInvested > 0 ? ((currentValue - totalInvested) / totalInvested) * 100 : 0,
      avgExecutionPrice,
      totalExecutions: strategies.reduce((sum, strategy) => sum + strategy.transactions.length, 0),
      nextExecution: nextExecution ? new Date(nextExecution).toISOString() : null
    }
  });
}));

export default router;
