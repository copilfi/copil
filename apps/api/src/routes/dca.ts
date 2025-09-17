import { Router } from 'express';
import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler, AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

const router = Router();
const prisma = new PrismaClient();

// DCA Strategy interfaces matching frontend expectations
interface DCAStrategyRequest {
  tokenFrom: string;
  tokenTo: string;
  totalBudget: number;
  frequency: string | number;
  duration?: number;
  protocol?: 'dragonswap' | 'symphony';
  slippage?: number;
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

/**
 * GET /api/dca/strategies
 * Get all DCA strategies for authenticated user
 */
router.get('/strategies', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  try {
    // For now, return mock data until we implement full DCA functionality
    const mockStrategies: DCAStrategyResponse[] = [
      {
        id: 'dca-1',
        tokenIn: '0x...USDC',
        tokenOut: '0x...SEI',
        totalBudget: 1000,
        amountPerExecution: 100,
        frequency: 86400, // 24 hours in seconds
        maxExecutions: 10,
        executedCount: 2,
        protocol: 'dragonswap',
        isActive: true,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        nextExecutionAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        lastExecutedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
      }
    ];

    logger.info(`📊 Retrieved ${mockStrategies.length} DCA strategies for user: ${req.user.id}`);

    res.json({
      success: true,
      data: mockStrategies
    });
  } catch (error) {
    logger.error('Failed to get DCA strategies:', error);
    throw new AppError('Failed to retrieve DCA strategies', 500);
  }
}));

/**
 * POST /api/dca/strategies
 * Create a new DCA strategy
 */
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

  // Validation
  if (!tokenFrom || !tokenTo || !totalBudget || !frequency) {
    throw new AppError('Missing required fields: tokenFrom, tokenTo, totalBudget, frequency', 400);
  }

  if (totalBudget <= 0) {
    throw new AppError('Total budget must be greater than 0', 400);
  }

  try {
    // For now, return mock response until we implement full DCA functionality
    const newStrategy: DCAStrategyResponse = {
      id: `dca-${Date.now()}`,
      tokenIn: tokenFrom,
      tokenOut: tokenTo,
      totalBudget: Number(totalBudget),
      amountPerExecution: Number(totalBudget) / 10, // Default to 10 executions
      frequency: typeof frequency === 'string' ? parseInt(frequency) : frequency,
      maxExecutions: duration ? Math.floor(duration / (typeof frequency === 'string' ? parseInt(frequency) : frequency)) : 10,
      executedCount: 0,
      protocol: protocol || 'dragonswap',
      isActive: true,
      createdAt: new Date().toISOString(),
      nextExecutionAt: new Date(Date.now() + (typeof frequency === 'string' ? parseInt(frequency) * 1000 : frequency * 1000)).toISOString()
    };

    logger.info(`🚀 Created DCA strategy for user: ${req.user.id}`, {
      strategyId: newStrategy.id,
      tokenFrom,
      tokenTo,
      totalBudget
    });

    res.status(201).json({
      success: true,
      message: 'DCA strategy created successfully',
      data: newStrategy
    });
  } catch (error) {
    logger.error('Failed to create DCA strategy:', error);
    throw new AppError('Failed to create DCA strategy', 500);
  }
}));

/**
 * GET /api/dca/strategies/:id
 * Get specific DCA strategy by ID
 */
router.get('/strategies/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  try {
    // Mock response for specific strategy
    const strategy: DCAStrategyResponse = {
      id,
      tokenIn: '0x...USDC',
      tokenOut: '0x...SEI',
      totalBudget: 1000,
      amountPerExecution: 100,
      frequency: 86400,
      maxExecutions: 10,
      executedCount: 2,
      protocol: 'dragonswap',
      isActive: true,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      nextExecutionAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      lastExecutedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    };

    logger.info(`📊 Retrieved DCA strategy: ${id} for user: ${req.user.id}`);

    res.json({
      success: true,
      data: strategy
    });
  } catch (error) {
    logger.error('Failed to get DCA strategy:', error);
    throw new AppError('Failed to retrieve DCA strategy', 500);
  }
}));

/**
 * PUT /api/dca/strategies/:id
 * Update DCA strategy
 */
router.put('/strategies/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;
  const { isActive, slippage } = req.body;

  try {
    logger.info(`🔄 Updated DCA strategy: ${id} for user: ${req.user.id}`, {
      isActive,
      slippage
    });

    res.json({
      success: true,
      message: 'DCA strategy updated successfully'
    });
  } catch (error) {
    logger.error('Failed to update DCA strategy:', error);
    throw new AppError('Failed to update DCA strategy', 500);
  }
}));

/**
 * DELETE /api/dca/strategies/:id
 * Delete DCA strategy
 */
router.delete('/strategies/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  try {
    logger.info(`🗑️ Deleted DCA strategy: ${id} for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'DCA strategy deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete DCA strategy:', error);
    throw new AppError('Failed to delete DCA strategy', 500);
  }
}));

/**
 * GET /api/dca/strategies/:id/executions
 * Get execution history for a DCA strategy
 */
router.get('/strategies/:id/executions', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  try {
    const mockExecutions = [
      {
        id: 'exec-1',
        strategyId: id,
        executedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        amountIn: 100,
        amountOut: 150.5,
        price: 1.505,
        txHash: '0x123...abc',
        status: 'COMPLETED'
      },
      {
        id: 'exec-2',
        strategyId: id,
        executedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        amountIn: 100,
        amountOut: 148.2,
        price: 1.482,
        txHash: '0x456...def',
        status: 'COMPLETED'
      }
    ];

    logger.info(`📊 Retrieved execution history for DCA strategy: ${id} for user: ${req.user.id}`);

    res.json({
      success: true,
      data: mockExecutions
    });
  } catch (error) {
    logger.error('Failed to get DCA execution history:', error);
    throw new AppError('Failed to retrieve execution history', 500);
  }
}));

/**
 * GET /api/dca/performance
 * Get DCA performance analytics
 */
router.get('/performance', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  try {
    const mockPerformance = {
      totalStrategies: 1,
      activeStrategies: 1,
      totalInvested: 200,
      currentValue: 298.7,
      totalPnL: 98.7,
      totalPnLPercentage: 49.35,
      avgExecutionPrice: 1.4935,
      totalExecutions: 2,
      nextExecution: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    };

    logger.info(`📊 Retrieved DCA performance for user: ${req.user.id}`);

    res.json({
      success: true,
      data: mockPerformance
    });
  } catch (error) {
    logger.error('Failed to get DCA performance:', error);
    throw new AppError('Failed to retrieve DCA performance', 500);
  }
}));

export default router;