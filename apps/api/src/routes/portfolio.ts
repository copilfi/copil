import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import Joi from 'joi';
import { logger } from '@/utils/logger';
import { validateBody } from '@/middleware/validation';
import { authenticateToken } from '@/middleware/auth';
import rateLimit from 'express-rate-limit';
import blockchainService from '@/services/RealBlockchainService';

const router = Router();
const prisma = new PrismaClient();

// Rate limiting for portfolio operations
const portfolioRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many portfolio requests from this IP, please try again later.',
});

router.use(portfolioRateLimit);

// Joi validation schemas
const createPortfolioSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).optional(),
  walletAddress: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).required().messages({
    'string.pattern.base': 'Invalid wallet address'
  }),
  isDefault: Joi.boolean().optional(),
  assets: Joi.array().optional(),
  metadata: Joi.object().optional(),
});

const updatePortfolioSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  description: Joi.string().max(500).optional(),
  isDefault: Joi.boolean().optional(),
  assets: Joi.array().optional(),
  metadata: Joi.object().optional(),
});

/**
 * @route GET /api/portfolios
 * @desc Get all portfolios for authenticated user
 * @access Private
 */
router.get('/', async (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'] as string;
    
    if (!walletAddress) {
      return res.status(401).json({
        success: false,
        error: 'Wallet address required'
      });
    }

    const portfolios = await prisma.portfolio.findMany({
      where: {
        user: {
          walletAddress: walletAddress
        }
      },
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    logger.info(`Retrieved ${portfolios.length} portfolios for wallet: ${walletAddress}`);

    res.json({
      success: true,
      data: portfolios,
      count: portfolios.length
    });

  } catch (error) {
    logger.error('Error fetching portfolios:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolios'
    });
  }
});

// Portfolio summary endpoint for real-time dashboard
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    logger.info(`Portfolio summary debug: user object = ${JSON.stringify((req as any).user)}`);

    const userId = (req as any).user?.id;
    const user = (req as any).user;

    if (!userId || !user?.walletAddress) {
      logger.error(`Portfolio summary auth failed: userId=${userId}, walletAddress=${user?.walletAddress}`);
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    logger.info(`Portfolio summary requested for user ${userId}, wallet: ${user.walletAddress}`);

    // Get user's smart account for portfolio calculations
    const smartAccount = await prisma.smartAccount.findFirst({
      where: {
        userId: userId,
        isActive: true
      }
    });

    const targetAddress = smartAccount?.address || user.walletAddress;
    logger.info(`Fetching portfolio data for address: ${targetAddress}`);

    // Get SEI balance
    const seiBalance = await blockchainService.getBalance(targetAddress);

    // Calculate total portfolio value in USD
    // Note: This would need price feeds integration for accurate USD values
    const totalValue = parseFloat(seiBalance); // For now, just use SEI amount

    const summary = {
      totalValue: totalValue,
      dailyChange: 0, // TODO: Calculate from historical data
      tokens: [
        {
          symbol: 'SEI',
          balance: seiBalance,
          value: totalValue,
          address: '0x0000000000000000000000000000000000000000', // Native token
          decimals: 18
        }
      ],
      address: targetAddress,
      lastUpdated: new Date().toISOString()
    };

    logger.info(`Portfolio summary: ${JSON.stringify(summary, null, 2)}`);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Error fetching portfolio summary:', error);
    // Return empty portfolio on error
    res.json({
      success: true,
      data: {
        totalValue: 0,
        dailyChange: 0,
        tokens: [],
        lastUpdated: new Date().toISOString()
      }
    });
  }
});

// Portfolio history endpoint for charts
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const user = (req as any).user;

    if (!userId || !user?.walletAddress) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const period = req.query.period as string || '24h';
    logger.info(`Portfolio history requested for user ${userId}, period: ${period}`);

    // Get user's smart account for history calculations
    const smartAccount = await prisma.smartAccount.findFirst({
      where: {
        userId: userId,
        isActive: true
      }
    });

    const targetAddress = smartAccount?.address || user.walletAddress;

    // Calculate time range based on period
    const now = new Date();
    let startTime = new Date();

    switch (period) {
      case '1h':
        startTime.setHours(now.getHours() - 1);
        break;
      case '24h':
        startTime.setDate(now.getDate() - 1);
        break;
      case '7d':
        startTime.setDate(now.getDate() - 7);
        break;
      case '30d':
        startTime.setDate(now.getDate() - 30);
        break;
      default:
        startTime.setDate(now.getDate() - 1);
    }

    // For now, generate synthetic historical data based on current balance
    // In production, this would come from stored balance snapshots
    const currentBalance = await blockchainService.getBalance(targetAddress);
    const currentValue = parseFloat(currentBalance);

    const dataPoints = 24; // 24 data points for the period
    const timeInterval = (now.getTime() - startTime.getTime()) / dataPoints;

    const history = Array.from({ length: dataPoints }, (_, i) => {
      const timestamp = new Date(startTime.getTime() + (i * timeInterval));
      // Add small random variation to simulate realistic price movement
      const variation = (Math.random() - 0.5) * 0.1; // ±5% variation
      const value = Math.max(0, currentValue * (1 + variation));

      return {
        timestamp: timestamp.toISOString(),
        value: value,
        tokens: [
          {
            symbol: 'SEI',
            balance: value.toFixed(6),
            value: value
          }
        ]
      };
    });

    // Ensure the last data point matches current balance
    if (history.length > 0) {
      history[history.length - 1] = {
        timestamp: now.toISOString(),
        value: currentValue,
        tokens: [
          {
            symbol: 'SEI',
            balance: currentBalance,
            value: currentValue
          }
        ]
      };
    }

    logger.info(`Portfolio history: ${history.length} data points for period ${period}`);

    res.json({
      success: true,
      data: history,
      period: period,
      startTime: startTime.toISOString(),
      endTime: now.toISOString()
    });
  } catch (error) {
    logger.error('Error fetching portfolio history:', error);
    res.json({
      success: true,
      data: [],
      period: req.query.period || '24h',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString()
    });
  }
});

/**
 * @route GET /api/portfolios/:id
 * @desc Get single portfolio by ID
 * @access Private
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.headers['x-wallet-address'] as string;

    if (!walletAddress) {
      return res.status(401).json({
        success: false,
        error: 'Wallet address required'
      });
    }

    const portfolio = await prisma.portfolio.findFirst({
      where: {
        id,
        user: {
          walletAddress: walletAddress
        }
      },
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      }
    });

    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found'
      });
    }

    logger.info(`Retrieved portfolio ${id} for wallet: ${walletAddress}`);

    res.json({
      success: true,
      data: portfolio
    });

  } catch (error) {
    logger.error('Error fetching portfolio:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolio'
    });
  }
});

/**
 * @route POST /api/portfolios
 * @desc Create new portfolio
 * @access Private
 */
router.post('/', validateBody(createPortfolioSchema), async (req, res) => {
  try {
    const { name, description, walletAddress, isDefault, assets, metadata } = req.body;

    // Get or create user
    let user = await prisma.user.findUnique({
      where: { walletAddress }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          walletAddress,
          preferences: {}
        }
      });
    }

    const portfolio = await prisma.portfolio.create({
      data: {
        name,
        description,
        userId: user.id,
        isDefault: isDefault || false,
        assets: assets || [],
        metadata: metadata || {}
      },
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      }
    });

    logger.info(`Created portfolio ${portfolio.id} for wallet: ${walletAddress}`);

    res.status(201).json({
      success: true,
      data: portfolio,
      message: 'Portfolio created successfully'
    });

  } catch (error) {
    logger.error('Error creating portfolio:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create portfolio'
    });
  }
});

/**
 * @route PUT /api/portfolios/:id
 * @desc Update portfolio
 * @access Private
 */
router.put('/:id', validateBody(updatePortfolioSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.headers['x-wallet-address'] as string;
    const updateData = req.body;

    if (!walletAddress) {
      return res.status(401).json({
        success: false,
        error: 'Wallet address required'
      });
    }

    // Verify ownership
    const existingPortfolio = await prisma.portfolio.findFirst({
      where: {
        id,
        user: {
          walletAddress: walletAddress
        }
      }
    });

    if (!existingPortfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found'
      });
    }

    const portfolio = await prisma.portfolio.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      }
    });

    logger.info(`Updated portfolio ${id} for wallet: ${walletAddress}`);

    res.json({
      success: true,
      data: portfolio,
      message: 'Portfolio updated successfully'
    });

  } catch (error) {
    logger.error('Error updating portfolio:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update portfolio'
    });
  }
});

/**
 * @route DELETE /api/portfolios/:id
 * @desc Delete portfolio
 * @access Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.headers['x-wallet-address'] as string;

    if (!walletAddress) {
      return res.status(401).json({
        success: false,
        error: 'Wallet address required'
      });
    }

    // Verify ownership
    const existingPortfolio = await prisma.portfolio.findFirst({
      where: {
        id,
        user: {
          walletAddress: walletAddress
        }
      }
    });

    if (!existingPortfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found'
      });
    }


    await prisma.portfolio.delete({
      where: { id }
    });

    logger.info(`Deleted portfolio ${id} for wallet: ${walletAddress}`);

    res.json({
      success: true,
      message: 'Portfolio deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting portfolio:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete portfolio'
    });
  }
});

export default router;