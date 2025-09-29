import express from 'express';
import { Prisma, PrismaClient, StrategyType } from '@prisma/client';
import { logger } from '@/utils/logger';
import { StrategyExecutionEngine } from '@/services/StrategyExecutionEngine';

const router = express.Router();

export function createStrategyRoutes(prisma: PrismaClient, executionEngine: StrategyExecutionEngine) {
  // Get all strategies for a user
  router.get('/user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const { active, type } = req.query;

      const whereClause: Prisma.StrategyWhereInput = { userId };
      
      if (active !== undefined) {
        whereClause.isActive = active === 'true';
      }
      if (typeof type === 'string') {
        const normalized = type.toUpperCase();
        if ((Object.values(StrategyType) as string[]).includes(normalized)) {
          whereClause.type = normalized as StrategyType;
        }
      }

      const strategies = await prisma.strategy.findMany({
        where: whereClause,
        include: {
          transactions: {
            take: 5,
            orderBy: { executedAt: 'desc' }
          }
        },
        orderBy: { createdAt: 'desc' as const }
      });

      res.json({
        success: true,
        data: strategies,
        count: strategies.length
      });
    } catch (error) {
      logger.error('Error fetching user strategies:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch strategies'
      });
    }
  });

  // Create new strategy
  router.post('/', async (req, res) => {
    try {
      const {
        userId,
        name,
        type,
        conditions,
        parameters,
        description,
        expiresAt
      } = req.body;

      if (!userId || !name || !type || !conditions || !parameters) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
        return;
      }

      // Validate conditions structure
      if (!Array.isArray(conditions)) {
        res.status(400).json({
          success: false,
          error: 'Conditions must be an array'
        });
        return;
      }

      const strategy = await prisma.strategy.create({
        data: {
          userId,
          name,
          type,
          description,
          conditions: conditions as Prisma.InputJsonValue,
          parameters: parameters as Prisma.InputJsonValue,
          expiresAt: expiresAt ? new Date(expiresAt) : null
        }
      });

      logger.info(`✅ Created strategy ${strategy.id} for user ${userId}`);

      res.status(201).json({
        success: true,
        data: strategy
      });
    } catch (error) {
      logger.error('Error creating strategy:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create strategy'
      });
    }
  });

  // Get strategy by ID
  router.get('/:strategyId', async (req, res) => {
    try {
      const { strategyId } = req.params;

      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        include: {
          user: {
            select: {
              id: true,
              walletAddress: true
            }
          },
          transactions: {
            orderBy: { executedAt: 'desc' }
          }
        }
      });

      if (!strategy) {
        res.status(404).json({
          success: false,
          error: 'Strategy not found'
        });
        return;
      }

      res.json({
        success: true,
        data: strategy
      });
    } catch (error) {
      logger.error('Error fetching strategy:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch strategy'
      });
    }
  });

  // Update strategy
  router.patch('/:strategyId', async (req, res) => {
    try {
      const { strategyId } = req.params;
      const {
        name,
        description,
        conditions,
        parameters,
        isActive,
        expiresAt
      } = req.body;

      const updateData: any = {};

      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;

      if (conditions !== undefined || parameters !== undefined) {
        const existingStrategy = await prisma.strategy.findUnique({
          where: { id: strategyId }
        });

        if (!existingStrategy) {
          res.status(404).json({
            success: false,
            error: 'Strategy not found'
          });
          return;
        }

        if (conditions !== undefined) {
          updateData.conditions = conditions as Prisma.InputJsonValue;
        }

        if (parameters !== undefined) {
          updateData.parameters = parameters as Prisma.InputJsonValue;
        }
      }

      const strategy = await prisma.strategy.update({
        where: { id: strategyId },
        data: updateData
      });

      logger.info(`✅ Updated strategy ${strategyId}`);

      res.json({
        success: true,
        data: strategy
      });
    } catch (error) {
      logger.error('Error updating strategy:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update strategy'
      });
      return;
    }
  });

  // Delete strategy
  router.delete('/:strategyId', async (req, res) => {
    try {
      const { strategyId } = req.params;

      await prisma.strategy.delete({
        where: { id: strategyId }
      });

      logger.info(`✅ Deleted strategy ${strategyId}`);

      res.json({
        success: true,
        message: 'Strategy deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting strategy:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete strategy'
      });
      return;
    }
  });

  // Execute strategy manually
  router.post('/:strategyId/execute', async (req, res) => {
    try {
      const { strategyId } = req.params;

      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        include: {
          user: {
            include: {
              smartAccounts: {
                where: { isActive: true }
              }
            }
          }
        }
      });

      if (!strategy) {
        res.status(404).json({
          success: false,
          error: 'Strategy not found'
        });
        return;
      }

      if (!strategy.isActive) {
        res.status(400).json({
          success: false,
          error: 'Strategy is not active'
        });
        return;
      }

      // This would trigger manual execution - for now just update lastExecutedAt
      await prisma.strategy.update({
        where: { id: strategyId },
        data: {
          lastExecutedAt: new Date(),
          executedCount: { increment: 1 }
        }
      });

      logger.info(`🚀 Manually triggered execution for strategy ${strategyId}`);

      res.json({
        success: true,
        message: 'Strategy execution triggered',
        strategyId
      });
    } catch (error) {
      logger.error('Error executing strategy:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute strategy'
      });
    }
  });

  // Get execution engine stats
  router.get('/engine/stats', async (req, res) => {
    try {
      const stats = await executionEngine.getStrategyStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error fetching engine stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch engine stats'
      });
    }
  });

  // Get strategy types and templates
  router.get('/templates/types', async (req, res) => {
    try {
      const templates = {
        SIMPLE_SWAP: {
          name: 'Simple Swap',
          description: 'Execute a simple token swap when conditions are met',
          requiredParameters: ['tokenIn', 'tokenOut', 'amountIn', 'minAmountOut', 'slippage'],
          supportedConditions: ['price', 'time']
        },
        CONDITIONAL_ORDER: {
          name: 'Conditional Order',
          description: 'Execute limit orders or stop-loss orders based on price conditions',
          requiredParameters: ['tokenIn', 'tokenOut', 'amountIn', 'targetPrice', 'orderType'],
          supportedConditions: ['price', 'volume']
        },
        DCA: {
          name: 'Dollar Cost Average',
          description: 'Periodically buy/sell tokens at regular intervals',
          requiredParameters: ['tokenIn', 'tokenOut', 'amountPerTrade', 'interval', 'totalRounds'],
          supportedConditions: ['time']
        },
        YIELD_OPTIMIZATION: {
          name: 'Yield Optimization',
          description: 'Automatically move funds to highest yielding pools',
          requiredParameters: ['baseToken', 'minYieldDifference', 'checkInterval'],
          supportedConditions: ['time', 'technical_indicator']
        },
        ARBITRAGE: {
          name: 'Arbitrage',
          description: 'Execute arbitrage trades across different DEXs',
          requiredParameters: ['tokenA', 'tokenB', 'minProfitBps', 'maxSlippage'],
          supportedConditions: ['price', 'volume']
        },
        PORTFOLIO_REBALANCING: {
          name: 'Portfolio Rebalancing',
          description: 'Maintain target asset allocation percentages',
          requiredParameters: ['targetAllocations', 'rebalanceThreshold', 'checkInterval'],
          supportedConditions: ['time', 'technical_indicator']
        }
      };

      res.json({
        success: true,
        data: templates
      });
    } catch (error) {
      logger.error('Error fetching strategy templates:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch strategy templates'
      });
    }
  });

  return router;
}
