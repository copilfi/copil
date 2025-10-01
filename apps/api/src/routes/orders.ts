import { Router, Response } from 'express';
import { Prisma, PrismaClient, Strategy, Transaction } from '@prisma/client';
import { ethers } from 'ethers';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler, AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { StrategyCondition } from '@/utils/strategyConditionNormalizer';
import env from '@/config/env';

const router = Router();
const prisma = new PrismaClient();

interface ConditionalOrderRequest {
  orderType: 'LIMIT_BUY' | 'LIMIT_SELL' | 'STOP_LOSS' | 'TAKE_PROFIT';
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  priceTarget?: number;
  timeDeadline?: number;
  slippage?: number;
  protocol?: 'dragonswap' | 'symphony';
}

interface ConditionalOrderResponse {
  id: string;
  orderType: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  minAmountOut: number;
  conditions: Array<{
    type: string;
    target: string;
    current: string;
    isMet: boolean;
  }>;
  isActive: boolean;
  createdAt: string;
  lastCheckedAt?: string;
  executedAt?: string;
  transactionHash?: string;
}

interface TokenResolution {
  address?: string;
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
}

interface ConditionalParameters {
  tokenIn?: TokenResolution;
  tokenOut?: TokenResolution;
  amountIn?: number;
  minAmountOut?: number;
  amountInWei?: string;
  minAmountOutWei?: string;
  slippage?: number;
  protocol?: string;
  orderType?: string;
  priceTarget?: number;
  timeDeadline?: string;
  dexRouter?: string;
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
        address,
        symbol,
        name,
        decimals
      };
    }
  }
  return undefined;
};

const parseConditionalParameters = (parameters: Prisma.JsonValue | null | undefined): ConditionalParameters => {
  const raw = toPlainObject(parameters);
  const tokenIn = normalizeTokenRef(raw.tokenIn ?? raw.inputToken);
  const tokenOut = normalizeTokenRef(raw.tokenOut ?? raw.outputToken);

  return {
    tokenIn,
    tokenOut,
    amountIn: toNumber(raw.amountIn ?? raw.inputAmount, 0),
    minAmountOut: toNumber(raw.minAmountOut ?? raw.minOutputAmount, 0),
    amountInWei: typeof raw.amountInWei === 'string' ? raw.amountInWei : undefined,
    minAmountOutWei: typeof raw.minAmountOutWei === 'string' ? raw.minAmountOutWei : undefined,
    slippage: toNumber(raw.slippage, NaN),
    protocol: typeof raw.protocol === 'string' ? raw.protocol : undefined,
    orderType: typeof raw.orderType === 'string' ? raw.orderType : undefined,
    priceTarget: toNumber(raw.priceTarget, NaN),
    timeDeadline: typeof raw.timeDeadline === 'string' ? raw.timeDeadline : undefined,
    dexRouter: typeof raw.dexRouter === 'string' ? raw.dexRouter : undefined
  };
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
      symbol: token.symbol || null,
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
    symbol: token.symbol || null,
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

const mapConditionToResponse = (condition: StrategyCondition): ConditionalOrderResponse['conditions'][number] => {
  const targetValue = condition.value ?? '';
  let target = '';

  switch (condition.type) {
    case 'price':
      target = `${targetValue}`;
      break;
    case 'time':
      target = new Date(targetValue).toISOString();
      break;
    default:
      target = `${targetValue}`;
  }

  return {
    type: condition.type.toUpperCase(),
    target,
    current: '',
    isMet: false
  };
};

const mapStrategyToConditionalOrder = (strategy: Strategy): ConditionalOrderResponse => {
  const params = parseConditionalParameters(strategy.parameters);
  const conditions: StrategyCondition[] = Array.isArray(strategy.conditions)
    ? (strategy.conditions as unknown as StrategyCondition[])
    : [];

  const slippage = Number.isFinite(params.slippage ?? NaN) ? params.slippage ?? 0 : 0;
  const decimalsIn = params.tokenIn?.decimals ?? 18;
  const decimalsOut = params.tokenOut?.decimals ?? 18;
  const amountInWei = params.amountInWei ?? (params.amountIn ? ethers.parseUnits(params.amountIn.toString(), decimalsIn).toString() : '0');
  const minAmountOutWei = params.minAmountOutWei ?? (params.minAmountOut ? ethers.parseUnits(params.minAmountOut.toString(), decimalsOut).toString() : '0');
  const amountIn = parseFloat(ethers.formatUnits(amountInWei, decimalsIn));
  const minAmountOut = parseFloat(ethers.formatUnits(minAmountOutWei, decimalsOut));

  return {
    id: strategy.id,
    orderType: params.orderType || strategy.name || 'CONDITIONAL_ORDER',
    tokenIn: tokenIdentifier(params.tokenIn),
    tokenOut: tokenIdentifier(params.tokenOut),
    amountIn,
    minAmountOut,
    conditions: conditions.map(mapConditionToResponse),
    isActive: strategy.isActive,
    createdAt: strategy.createdAt.toISOString(),
    lastCheckedAt: strategy.updatedAt.toISOString(),
    executedAt: strategy.lastExecutedAt ? strategy.lastExecutedAt.toISOString() : undefined,
    transactionHash: undefined
  };
};

const mapTransactionToStatus = (transaction: Transaction): ConditionalOrderResponse['conditions'][number] => {
  const amountIn = sumTokenAmount(transaction.tokensIn);
  const amountOut = sumTokenAmount(transaction.tokensOut);
  const price = amountIn > 0 ? amountOut / amountIn : 0;

  return {
    type: 'EXECUTION',
    target: transaction.txHash,
    current: price.toString(),
    isMet: transaction.status === 'CONFIRMED'
  };
};

router.get('/conditional', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const strategies = await prisma.strategy.findMany({
    where: {
      userId: req.user.id,
      type: 'CONDITIONAL_ORDER'
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  const data = strategies.map(mapStrategyToConditionalOrder);

  logger.info(`📋 Retrieved ${data.length} conditional orders for user ${req.user.id}`);

  res.json({
    success: true,
    data
  });
}));

router.post('/conditional', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const {
    orderType,
    tokenIn,
    tokenOut,
    amountIn,
    priceTarget,
    timeDeadline,
    slippage = 1.0,
    protocol = 'dragonswap'
  }: ConditionalOrderRequest = req.body;

  if (!orderType || !tokenIn || !tokenOut || !amountIn) {
    throw new AppError('Missing required fields: orderType, tokenIn, tokenOut, amountIn', 400);
  }

  if (amountIn <= 0) {
    throw new AppError('Amount must be greater than 0', 400);
  }

  const [tokenInResolved, tokenOutResolved] = await Promise.all([
    resolveToken(tokenIn, 'tokenIn'),
    resolveToken(tokenOut, 'tokenOut')
  ]);

  let normalizedPriceTarget = priceTarget ?? 0;
  if (normalizedPriceTarget <= 0 && (orderType === 'LIMIT_BUY' || orderType === 'LIMIT_SELL' || orderType === 'STOP_LOSS' || orderType === 'TAKE_PROFIT')) {
    throw new AppError('Price target must be greater than 0 for conditional orders', 400);
  }

  const slippageFactor = 1 - (slippage / 100);
  const minAmountOut = normalizedPriceTarget > 0 ? amountIn * normalizedPriceTarget * slippageFactor : amountIn * slippageFactor;

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

  const decimalsIn = tokenInResolved.decimals ?? 18;
  const decimalsOut = tokenOutResolved.decimals ?? 18;
  const amountInWei = ethers.parseUnits(amountIn.toString(), decimalsIn).toString();
  const minAmountOutWei = ethers.parseUnits(minAmountOut.toString(), decimalsOut).toString();

  const conditions: StrategyCondition[] = [];

  if (normalizedPriceTarget > 0) {
    let operator: StrategyCondition['operator'] = 'eq';
    switch (orderType) {
      case 'LIMIT_BUY':
      case 'STOP_LOSS':
        operator = 'lte';
        break;
      case 'LIMIT_SELL':
      case 'TAKE_PROFIT':
        operator = 'gte';
        break;
      default:
        operator = 'eq';
    }

    conditions.push({
      type: 'price',
      operator,
      value: normalizedPriceTarget.toString(),
      tokenAddress: tokenOutResolved.address || undefined,
      tokenSymbol: (tokenOutResolved.symbol || undefined)?.toUpperCase(),
      metadata: {
        sourceType: 'price_target'
      },
      normalized: true
    });
  }

  if (timeDeadline) {
    conditions.push({
      type: 'time',
      operator: 'lte',
      value: new Date(timeDeadline).toISOString(),
      metadata: {
        sourceType: 'time_deadline'
      },
      normalized: true
    });
  }

  const parameters = {
    tokenIn: {
      address: tokenInResolved.address || null,
      symbol: tokenInResolved.symbol || null,
      name: tokenInResolved.name || null,
      decimals: tokenInResolved.decimals ?? null
    },
    tokenOut: {
      address: tokenOutResolved.address || null,
      symbol: tokenOutResolved.symbol || null,
      name: tokenOutResolved.name || null,
      decimals: tokenOutResolved.decimals ?? null
    },
    amountIn,
    minAmountOut,
    amountInWei,
    minAmountOutWei,
    slippage,
    protocol,
    orderType,
    priceTarget: normalizedPriceTarget,
    timeDeadline: timeDeadline ? new Date(timeDeadline).toISOString() : null,
    dexRouter: dexRouterAddress
  };

  const strategy = await prisma.strategy.create({
    data: {
      userId: req.user.id,
      name: orderType,
      type: 'CONDITIONAL_ORDER',
      description: 'Conditional order strategy',
      conditions: conditions as unknown as Prisma.JsonArray,
      parameters: parameters as unknown as Prisma.JsonObject,
      isActive: false
    }
  });

  logger.info(`🚀 Created conditional order strategy ${strategy.id} for user ${req.user.id}`);

  res.status(201).json({
    success: true,
    data: mapStrategyToConditionalOrder(strategy)
  });
}));

router.get('/conditional/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const strategy = await prisma.strategy.findFirst({
    where: {
      id,
      userId: req.user.id,
      type: 'CONDITIONAL_ORDER'
    }
  });

  if (!strategy) {
    throw new AppError('Conditional order not found', 404);
  }

  res.json({
    success: true,
    data: mapStrategyToConditionalOrder(strategy)
  });
}));

router.delete('/conditional/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const deleted = await prisma.strategy.deleteMany({
    where: {
      id,
      userId: req.user.id,
      type: 'CONDITIONAL_ORDER'
    }
  });

  if (deleted.count === 0) {
    throw new AppError('Conditional order not found', 404);
  }

  logger.info(`🗑️ Deleted conditional order ${id} for user ${req.user.id}`);

  res.json({
    success: true,
    message: 'Conditional order deleted successfully'
  });
}));

router.get('/conditional/:id/status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const strategy = await prisma.strategy.findFirst({
    where: {
      id,
      userId: req.user.id,
      type: 'CONDITIONAL_ORDER'
    }
  });

  if (!strategy) {
    throw new AppError('Conditional order not found', 404);
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      strategyId: id,
      userId: req.user.id
    },
    orderBy: {
      executedAt: 'desc'
    }
  });

  const baseConditions: StrategyCondition[] = Array.isArray(strategy.conditions)
    ? (strategy.conditions as unknown as StrategyCondition[])
    : [];

  const conditions = baseConditions.map(mapConditionToResponse);

  const latestTx = transactions[0];
  const transactionHash = latestTx?.txHash;

  if (latestTx) {
    conditions.push(mapTransactionToStatus(latestTx));
  }

  res.json({
    success: true,
    data: {
      orderId: strategy.id,
      isActive: strategy.isActive,
      status: latestTx?.status ?? 'PENDING',
      lastCheckedAt: strategy.updatedAt.toISOString(),
      executedAt: strategy.lastExecutedAt ? strategy.lastExecutedAt.toISOString() : undefined,
      transactionHash,
      conditions
    }
  });
}));

export default router;
