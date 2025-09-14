import { Request, Response } from 'express';
import { AutomationManager, ConditionType } from '@copil/blockchain';
import { BlockchainLogger } from '@copil/blockchain';
import { z } from 'zod';

const logger = BlockchainLogger.getInstance();

// Request validation schemas
const CreateConditionalOrderSchema = z.object({
  orderType: z.enum(['LIMIT_BUY', 'LIMIT_SELL', 'STOP_LOSS', 'TAKE_PROFIT']),
  tokenIn: z.string().min(1, 'Input token is required'),
  tokenOut: z.string().min(1, 'Output token is required'),
  amountIn: z.number().positive('Amount must be positive'),
  priceTarget: z.number().positive('Price target must be positive').optional(),
  timeDeadline: z.number().positive().optional(),
  slippage: z.number().min(0).max(50).optional(),
  protocol: z.enum(['dragonswap', 'symphony']).optional()
});

const UpdateConditionalOrderSchema = z.object({
  priceTarget: z.number().positive().optional(),
  timeDeadline: z.number().positive().optional(),
  slippage: z.number().min(0).max(50).optional()
});

// Order type to numeric mapping for backend
const ORDER_TYPE_MAPPING = {
  'LIMIT_BUY': 0,
  'LIMIT_SELL': 1,
  'STOP_LOSS': 2,
  'TAKE_PROFIT': 3
} as const;

export class OrderController {
  private automationManager: AutomationManager;

  constructor(automationManager: AutomationManager) {
    this.automationManager = automationManager;
  }

  /**
   * Create a new conditional order
   */
  createConditionalOrder = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const validatedData = CreateConditionalOrderSchema.parse(req.body);
      
      const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const orderType = ORDER_TYPE_MAPPING[validatedData.orderType];
      
      // Convert amounts to wei
      const amountInWei = BigInt(Math.floor(validatedData.amountIn * 1e18));
      
      // Build conditions based on order type and parameters
      const conditions = this.buildOrderConditions(
        validatedData.orderType,
        validatedData.tokenIn,
        validatedData.priceTarget,
        validatedData.timeDeadline
      );

      // Estimate minimum output (simplified for now)
      const minAmountOutWei = amountInWei * 95n / 100n; // 5% slippage protection

      // Generate call data (simplified - would use real ABI encoding)
      const callData = this.generateSwapCallData(
        validatedData.tokenIn,
        validatedData.tokenOut,
        amountInWei,
        validatedData.protocol || 'dragonswap'
      );

      // Get target contract address
      const targetContract = validatedData.protocol === 'symphony' 
        ? '0x123...' // Symphony router address
        : '0x456...'; // DragonSwap router address

      // Create conditional order
      const order = await this.automationManager.addConditionalOrder({
        orderId,
        userId,
        orderType,
        tokenIn: validatedData.tokenIn,
        tokenOut: validatedData.tokenOut,
        amountIn: amountInWei,
        minAmountOut: minAmountOutWei,
        conditions,
        targetContract,
        callData
      });

      logger.info('Conditional order created via API', {
        userId,
        orderId,
        orderType: validatedData.orderType,
        tokenIn: validatedData.tokenIn,
        tokenOut: validatedData.tokenOut
      });

      res.json({
        success: true,
        message: 'Conditional order created successfully',
        data: {
          id: order.orderId,
          orderType: validatedData.orderType,
          tokenIn: validatedData.tokenIn,
          tokenOut: validatedData.tokenOut,
          amountIn: validatedData.amountIn,
          priceTarget: validatedData.priceTarget,
          timeDeadline: validatedData.timeDeadline,
          conditions: conditions.map(c => ({
            type: this.getConditionTypeName(c.conditionType),
            target: c.targetValue,
            current: c.currentValue,
            isMet: c.isMet
          })),
          isActive: order.isActive,
          createdAt: order.createdAt.toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to create conditional order', error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  };

  /**
   * Get user's conditional orders
   */
  getConditionalOrders = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const orders = this.automationManager.getUserConditionalOrders(userId);

      res.json({
        success: true,
        data: orders.map(order => ({
          id: order.orderId,
          orderType: this.getOrderTypeName(order.orderType),
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amountIn: Number(order.amountIn) / 1e18,
          minAmountOut: Number(order.minAmountOut) / 1e18,
          conditions: order.conditions.map(c => ({
            type: this.getConditionTypeName(c.conditionType),
            target: c.targetValue,
            current: c.currentValue,
            isMet: c.isMet
          })),
          isActive: order.isActive,
          createdAt: order.createdAt.toISOString(),
          lastCheckedAt: order.lastCheckedAt?.toISOString(),
          executedAt: order.executedAt?.toISOString(),
          transactionHash: order.transactionHash
        }))
      });

    } catch (error) {
      logger.error('Failed to get conditional orders', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve conditional orders'
      });
    }
  };

  /**
   * Get specific conditional order
   */
  getConditionalOrder = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const orderId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const order = this.automationManager.getUserConditionalOrders(userId)
        .find(o => o.orderId === orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Conditional order not found'
        });
      }

      res.json({
        success: true,
        data: {
          id: order.orderId,
          orderType: this.getOrderTypeName(order.orderType),
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amountIn: Number(order.amountIn) / 1e18,
          minAmountOut: Number(order.minAmountOut) / 1e18,
          conditions: order.conditions.map(c => ({
            type: this.getConditionTypeName(c.conditionType),
            target: c.targetValue,
            current: c.currentValue,
            isMet: c.isMet
          })),
          isActive: order.isActive,
          createdAt: order.createdAt.toISOString(),
          lastCheckedAt: order.lastCheckedAt?.toISOString(),
          executedAt: order.executedAt?.toISOString(),
          transactionHash: order.transactionHash
        }
      });

    } catch (error) {
      logger.error('Failed to get conditional order', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve conditional order'
      });
    }
  };

  /**
   * Cancel conditional order
   */
  cancelConditionalOrder = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const orderId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const success = await this.automationManager.removeConditionalOrder(orderId, userId);
      
      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Conditional order not found'
        });
      }

      logger.info('Conditional order cancelled via API', {
        userId,
        orderId
      });

      res.json({
        success: true,
        message: 'Conditional order cancelled successfully'
      });

    } catch (error) {
      logger.error('Failed to cancel conditional order', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel conditional order'
      });
    }
  };

  /**
   * Update conditional order
   */
  updateConditionalOrder = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const orderId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const validatedData = UpdateConditionalOrderSchema.parse(req.body);

      // For now, we don't support updating orders after creation
      // This would require more complex logic in the automation system
      res.status(400).json({
        success: false,
        error: 'Order updates not supported yet. Please cancel and create a new order.'
      });

    } catch (error) {
      logger.error('Failed to update conditional order', error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update conditional order'
      });
    }
  };

  /**
   * Get order status and progress
   */
  getOrderStatus = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const orderId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const order = this.automationManager.getUserConditionalOrders(userId)
        .find(o => o.orderId === orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Conditional order not found'
        });
      }

      const conditionsMet = order.conditions.filter(c => c.isMet).length;
      const totalConditions = order.conditions.length;

      res.json({
        success: true,
        data: {
          orderId,
          status: order.executedAt ? 'EXECUTED' : order.isActive ? 'ACTIVE' : 'CANCELLED',
          progress: {
            conditionsMet,
            totalConditions,
            percentage: totalConditions > 0 ? (conditionsMet / totalConditions) * 100 : 0
          },
          conditions: order.conditions.map(c => ({
            type: this.getConditionTypeName(c.conditionType),
            target: c.targetValue,
            current: c.currentValue,
            isMet: c.isMet
          })),
          lastChecked: order.lastCheckedAt?.toISOString(),
          executedAt: order.executedAt?.toISOString(),
          transactionHash: order.transactionHash
        }
      });

    } catch (error) {
      logger.error('Failed to get order status', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve order status'
      });
    }
  };

  /**
   * Build conditions array based on order parameters
   */
  private buildOrderConditions(
    orderType: string,
    tokenAddress: string,
    priceTarget?: number,
    timeDeadline?: number
  ): any[] {
    const conditions: any[] = [];

    if (priceTarget) {
      const conditionType = orderType === 'LIMIT_BUY' || orderType === 'STOP_LOSS' 
        ? ConditionType.PRICE_BELOW 
        : ConditionType.PRICE_ABOVE;

      conditions.push({
        conditionType,
        tokenAddress,
        targetValue: (priceTarget * 1e18).toString(), // Convert to wei-like precision
        currentValue: '0',
        isMet: false,
        extraData: '0x'
      });
    }

    if (timeDeadline) {
      conditions.push({
        conditionType: ConditionType.TIME_BASED,
        tokenAddress: '0x0000000000000000000000000000000000000000',
        targetValue: timeDeadline.toString(),
        currentValue: '0',
        isMet: false,
        extraData: '0x'
      });
    }

    return conditions;
  }

  /**
   * Generate swap call data (simplified)
   */
  private generateSwapCallData(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    protocol: string
  ): string {
    // This would use real ABI encoding in production
    // For now, return a placeholder that indicates the swap parameters
    return `0x${protocol === 'symphony' ? '38ed1739' : '414bf389'}${tokenIn.slice(2)}${tokenOut.slice(2)}${amountIn.toString(16).padStart(64, '0')}`;
  }

  /**
   * Convert numeric order type to string
   */
  private getOrderTypeName(orderType: number): string {
    const typeMap = {
      0: 'LIMIT_BUY',
      1: 'LIMIT_SELL',
      2: 'STOP_LOSS',
      3: 'TAKE_PROFIT'
    };
    return typeMap[orderType as keyof typeof typeMap] || 'UNKNOWN';
  }

  /**
   * Convert numeric condition type to string
   */
  private getConditionTypeName(conditionType: number): string {
    const typeMap = {
      0: 'PRICE_ABOVE',
      1: 'PRICE_BELOW',
      2: 'TIME_BASED',
      3: 'BALANCE_THRESHOLD'
    };
    return typeMap[conditionType as keyof typeof typeMap] || 'UNKNOWN';
  }
}