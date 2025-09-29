import { Response } from 'express';
import { DCAScheduler, AutomationManager } from '@copil/blockchain';
import { logger } from '@/utils/logger';
import { AuthenticatedRequest } from '@/middleware/auth';
import { z } from 'zod';

// Request validation schemas
const CreateDCAStrategySchema = z.object({
  tokenFrom: z.string().min(1, 'Token from is required'),
  tokenTo: z.string().min(1, 'Token to is required'),
  totalBudget: z.number().positive('Total budget must be positive'),
  frequency: z.enum(['daily', 'weekly', 'monthly']).or(z.number().positive()),
  duration: z.number().positive('Duration must be positive').optional(),
  protocol: z.enum(['dragonswap', 'symphony']).optional(),
  slippage: z.number().min(0).max(50).optional()
});

const UpdateDCAStrategySchema = z.object({
  isActive: z.boolean().optional(),
  slippage: z.number().min(0).max(50).optional()
});

export class DCAController {
  private automationManager: AutomationManager;

  constructor(automationManager: AutomationManager) {
    this.automationManager = automationManager;
  }

  /**
   * Create a new DCA strategy
   */
  createDCAStrategy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const validatedData = CreateDCAStrategySchema.parse(req.body);
      
      // Convert frequency to seconds
      let frequencyInSeconds: number;
      if (typeof validatedData.frequency === 'string') {
        switch (validatedData.frequency) {
          case 'daily':
            frequencyInSeconds = 24 * 3600;
            break;
          case 'weekly':
            frequencyInSeconds = 7 * 24 * 3600;
            break;
          case 'monthly':
            frequencyInSeconds = 30 * 24 * 3600;
            break;
          default:
            throw new Error('Invalid frequency');
        }
      } else {
        frequencyInSeconds = validatedData.frequency * 3600; // hours to seconds
      }

      // Calculate max executions
      const durationInDays = validatedData.duration || 30;
      const maxExecutions = Math.floor((durationInDays * 24 * 3600) / frequencyInSeconds);

      if (maxExecutions === 0) {
        res.status(400).json({
          success: false,
          error: 'Duration too short for the given frequency'
        });
        return;
      }

      // Convert total budget to wei (assuming 18 decimals for now)
      const totalBudgetInWei = BigInt(Math.floor(validatedData.totalBudget * 1e18));

      // Create DCA strategy
      const strategy = await this.automationManager.addDCAStrategy({
        userId,
        tokenIn: validatedData.tokenFrom,
        tokenOut: validatedData.tokenTo,
        totalBudget: totalBudgetInWei,
        frequency: frequencyInSeconds,
        maxExecutions,
        protocol: validatedData.protocol || 'dragonswap'
      });

      logger.info('DCA strategy created via API', {
        userId,
        strategyId: strategy.id,
        tokenIn: validatedData.tokenFrom,
        tokenOut: validatedData.tokenTo
      });

      res.json({
        success: true,
        message: 'DCA strategy created successfully',
        data: {
          id: strategy.id,
          tokenFrom: validatedData.tokenFrom,
          tokenTo: validatedData.tokenTo,
          totalBudget: validatedData.totalBudget,
          frequency: validatedData.frequency,
          duration: durationInDays,
          maxExecutions,
          executedCount: strategy.executedCount,
          nextExecution: strategy.nextExecutionAt.toISOString(),
          isActive: strategy.isActive,
          createdAt: strategy.createdAt.toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to create DCA strategy', error);
      
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
      return;
    }
  };

  /**
   * Get user's DCA strategies
   */
  getDCAStrategies = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const strategies = this.automationManager.getUserDCAStrategies(userId);

      res.json({
        success: true,
        data: strategies.map(strategy => ({
          id: strategy.id,
          tokenIn: strategy.tokenIn,
          tokenOut: strategy.tokenOut,
          totalBudget: Number(strategy.totalBudget) / 1e18, // Convert from wei
          amountPerExecution: Number(strategy.amountPerExecution) / 1e18,
          frequency: strategy.frequency,
          maxExecutions: strategy.maxExecutions,
          executedCount: strategy.executedCount,
          protocol: strategy.protocol,
          isActive: strategy.isActive,
          createdAt: strategy.createdAt.toISOString(),
          nextExecutionAt: strategy.nextExecutionAt.toISOString(),
          lastExecutedAt: strategy.lastExecutedAt?.toISOString()
        }))
      });

    } catch (error) {
      logger.error('Failed to get DCA strategies', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve DCA strategies'
      });
      return;
    }
  };

  /**
   * Get specific DCA strategy
   */
  getDCAStrategy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const strategyId = req.params.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const strategy = this.automationManager.getUserDCAStrategies(userId)
        .find(s => s.id === strategyId);

      if (!strategy) {
        res.status(404).json({
          success: false,
          error: 'DCA strategy not found'
        });
        return;
      }

      res.json({
        success: true,
        data: {
          id: strategy.id,
          tokenIn: strategy.tokenIn,
          tokenOut: strategy.tokenOut,
          totalBudget: Number(strategy.totalBudget) / 1e18,
          amountPerExecution: Number(strategy.amountPerExecution) / 1e18,
          frequency: strategy.frequency,
          maxExecutions: strategy.maxExecutions,
          executedCount: strategy.executedCount,
          protocol: strategy.protocol,
          isActive: strategy.isActive,
          createdAt: strategy.createdAt.toISOString(),
          nextExecutionAt: strategy.nextExecutionAt.toISOString(),
          lastExecutedAt: strategy.lastExecutedAt?.toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to get DCA strategy', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve DCA strategy'
      });
    }
  };

  /**
   * Update DCA strategy
   */
  updateDCAStrategy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const strategyId = req.params.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const validatedData = UpdateDCAStrategySchema.parse(req.body);
      
      // For now, we only support pausing/resuming strategies
      // More complex updates would require modifying the AutomationManager
      if (validatedData.isActive === false) {
        const success = await this.automationManager.removeDCAStrategy(strategyId, userId);
        
        if (!success) {
          res.status(404).json({
            success: false,
            error: 'DCA strategy not found'
          });
          return;
        }

        res.json({
          success: true,
          message: 'DCA strategy paused successfully'
        });
        return;
      } else {
        res.status(400).json({
          success: false,
          error: 'Only pausing strategies is currently supported'
        });
        return;
      }

    } catch (error) {
      logger.error('Failed to update DCA strategy', error);
      
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update DCA strategy'
      });
      return;
    }
  };

  /**
   * Delete/Cancel DCA strategy
   */
  deleteDCAStrategy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const strategyId = req.params.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const success = await this.automationManager.removeDCAStrategy(strategyId, userId);
      
      if (!success) {
        res.status(404).json({
          success: false,
          error: 'DCA strategy not found'
        });
        return;
      }

      logger.info('DCA strategy cancelled via API', {
        userId,
        strategyId
      });

      res.json({
        success: true,
        message: 'DCA strategy cancelled successfully'
      });

    } catch (error) {
      logger.error('Failed to delete DCA strategy', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel DCA strategy'
      });
      return;
    }
  };

  /**
   * Get DCA execution history
   */
  getDCAExecutionHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const strategyId = req.params.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      // For now, return basic execution info
      // In a full implementation, this would query execution history from database
      const strategy = this.automationManager.getUserDCAStrategies(userId)
        .find(s => s.id === strategyId);

      if (!strategy) {
        res.status(404).json({
          success: false,
          error: 'DCA strategy not found'
        });
        return;
      }

      res.json({
        success: true,
        data: {
          strategyId,
          totalExecutions: strategy.executedCount,
          nextExecution: strategy.isActive ? strategy.nextExecutionAt.toISOString() : null,
          // In real implementation, would include:
          // executions: [{
          //   id: string,
          //   executedAt: string,
          //   amountIn: number,
          //   amountOut: number,
          //   transactionHash: string,
          //   gasUsed: string,
          //   price: number
          // }]
          executions: [] // Placeholder - would come from execution tracking
        }
      });

    } catch (error) {
      logger.error('Failed to get DCA execution history', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve execution history'
      });
      return;
    }
  };

  /**
   * Get DCA performance metrics
   */
  getDCAPerformance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const strategies = this.automationManager.getUserDCAStrategies(userId);
      const stats = this.automationManager.getStats();

      res.json({
        success: true,
        data: {
          totalStrategies: strategies.length,
          activeStrategies: strategies.filter(s => s.isActive).length,
          totalExecutions: stats.dca.totalExecutions,
          lastExecution: stats.dca.lastExecution?.toISOString(),
          // Additional metrics would be calculated from execution history
          totalInvested: 0, // Placeholder
          totalReturns: 0, // Placeholder
          averageCost: 0, // Placeholder
          bestPerformer: null // Placeholder
        }
      });

    } catch (error) {
      logger.error('Failed to get DCA performance', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve performance metrics'
      });
      return;
    }
  };
}
