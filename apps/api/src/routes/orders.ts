import { Router } from 'express';
import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler, AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

const router = Router();
const prisma = new PrismaClient();

// Conditional Order interfaces matching frontend expectations
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

/**
 * GET /api/orders/conditional
 * Get all conditional orders for authenticated user
 */
router.get('/conditional', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  try {
    // For now, return mock data until we implement full conditional orders functionality
    const mockOrders: ConditionalOrderResponse[] = [
      {
        id: 'order-1',
        orderType: 'LIMIT_BUY',
        tokenIn: '0x...USDC',
        tokenOut: '0x...SEI',
        amountIn: 500,
        minAmountOut: 750,
        conditions: [
          {
            type: 'PRICE',
            target: '1.50',
            current: '1.65',
            isMet: false
          }
        ],
        isActive: true,
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        lastCheckedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
      },
      {
        id: 'order-2',
        orderType: 'TAKE_PROFIT',
        tokenIn: '0x...SEI',
        tokenOut: '0x...USDC',
        amountIn: 1000,
        minAmountOut: 1800,
        conditions: [
          {
            type: 'PRICE',
            target: '1.80',
            current: '1.65',
            isMet: false
          }
        ],
        isActive: true,
        createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        lastCheckedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString()
      }
    ];

    logger.info(`📋 Retrieved ${mockOrders.length} conditional orders for user: ${req.user.id}`);

    res.json({
      success: true,
      data: mockOrders
    });
  } catch (error) {
    logger.error('Failed to get conditional orders:', error);
    throw new AppError('Failed to retrieve conditional orders', 500);
  }
}));

/**
 * POST /api/orders/conditional
 * Create a new conditional order
 */
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

  // Validation
  if (!orderType || !tokenIn || !tokenOut || !amountIn) {
    throw new AppError('Missing required fields: orderType, tokenIn, tokenOut, amountIn', 400);
  }

  if (amountIn <= 0) {
    throw new AppError('Amount must be greater than 0', 400);
  }

  if (priceTarget && priceTarget <= 0) {
    throw new AppError('Price target must be greater than 0', 400);
  }

  try {
    // Calculate minAmountOut based on priceTarget and slippage
    const minAmountOut = priceTarget ? amountIn * priceTarget * (1 - slippage / 100) : amountIn * 0.95;

    // For now, return mock response until we implement full conditional orders functionality
    const newOrder: ConditionalOrderResponse = {
      id: `order-${Date.now()}`,
      orderType,
      tokenIn,
      tokenOut,
      amountIn: Number(amountIn),
      minAmountOut: Number(minAmountOut),
      conditions: [
        {
          type: 'PRICE',
          target: priceTarget?.toString() || '1.00',
          current: '1.65', // Mock current price
          isMet: false
        }
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString()
    };

    // Add time deadline condition if specified
    if (timeDeadline) {
      newOrder.conditions.push({
        type: 'TIME',
        target: new Date(timeDeadline).toISOString(),
        current: new Date().toISOString(),
        isMet: false
      });
    }

    logger.info(`🚀 Created conditional order for user: ${req.user.id}`, {
      orderId: newOrder.id,
      orderType,
      tokenIn,
      tokenOut,
      amountIn
    });

    res.status(201).json({
      success: true,
      message: 'Conditional order created successfully',
      data: newOrder
    });
  } catch (error) {
    logger.error('Failed to create conditional order:', error);
    throw new AppError('Failed to create conditional order', 500);
  }
}));

/**
 * GET /api/orders/conditional/:id
 * Get specific conditional order by ID
 */
router.get('/conditional/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  try {
    // Mock response for specific order
    const order: ConditionalOrderResponse = {
      id,
      orderType: 'LIMIT_BUY',
      tokenIn: '0x...USDC',
      tokenOut: '0x...SEI',
      amountIn: 500,
      minAmountOut: 750,
      conditions: [
        {
          type: 'PRICE',
          target: '1.50',
          current: '1.65',
          isMet: false
        }
      ],
      isActive: true,
      createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      lastCheckedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    };

    logger.info(`📋 Retrieved conditional order: ${id} for user: ${req.user.id}`);

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    logger.error('Failed to get conditional order:', error);
    throw new AppError('Failed to retrieve conditional order', 500);
  }
}));

/**
 * DELETE /api/orders/conditional/:id
 * Cancel conditional order
 */
router.delete('/conditional/:id', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  try {
    logger.info(`🗑️ Cancelled conditional order: ${id} for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Conditional order cancelled successfully'
    });
  } catch (error) {
    logger.error('Failed to cancel conditional order:', error);
    throw new AppError('Failed to cancel conditional order', 500);
  }
}));

/**
 * GET /api/orders/conditional/:id/status
 * Get order status with progress and conditions
 */
router.get('/conditional/:id/status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  try {
    const mockStatus = {
      orderId: id,
      status: 'ACTIVE' as const,
      progress: {
        conditionsMet: 0,
        totalConditions: 1,
        percentage: 0
      },
      conditions: [
        {
          type: 'PRICE',
          target: '1.50',
          current: '1.65',
          isMet: false
        }
      ],
      lastChecked: new Date(Date.now() - 2 * 60 * 1000).toISOString()
    };

    logger.info(`📊 Retrieved order status: ${id} for user: ${req.user.id}`);

    res.json({
      success: true,
      data: mockStatus
    });
  } catch (error) {
    logger.error('Failed to get order status:', error);
    throw new AppError('Failed to retrieve order status', 500);
  }
}));

export default router;