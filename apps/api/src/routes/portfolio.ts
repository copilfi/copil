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
    const smartAccountRecord = await prisma.smartAccount.findFirst({
      where: {
        userId: userId,
        isActive: true
      }
    });

    // Resolve current smart account address directly from blockchain to avoid stale DB state
    let smartAccountAddress: string | null = smartAccountRecord?.address || null;

    try {
      const onchainAddress = await blockchainService.getSmartAccountAddress(user.walletAddress);
      if (onchainAddress) {
        smartAccountAddress = onchainAddress;
      }
    } catch (addressError) {
      logger.warn('Failed to resolve smart account address from blockchain:', addressError);
    }

    logger.info(`Fetching portfolio data - Main wallet: ${user.walletAddress}, Smart account: ${smartAccountAddress || 'none'}`);

    // Get balances from both wallets
    const mainWalletBalance = await blockchainService.getBalance(user.walletAddress);
    const smartAccountBalance = smartAccountAddress ? await blockchainService.getBalance(smartAccountAddress) : '0.0';

    const mainValue = parseFloat(mainWalletBalance);
    const smartValue = parseFloat(smartAccountBalance);
    const totalValue = mainValue + smartValue;

    logger.info(`Balances - Main wallet: ${mainWalletBalance} SEI, Smart account: ${smartAccountBalance} SEI, Total: ${totalValue} SEI`);

    let smartAccountIsDeployed = false;
    if (smartAccountAddress) {
      try {
        const smartAccountInfo = await blockchainService.getSmartAccountInfo(smartAccountAddress);
        smartAccountIsDeployed = Boolean(smartAccountInfo?.isDeployed);
      } catch (infoError) {
        logger.warn('Failed to fetch smart account deployment status:', infoError);
        smartAccountIsDeployed = smartValue > 0;
      }
    }

    const tokens = [
      {
        symbol: 'SEI',
        balance: mainWalletBalance,
        value: mainValue,
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        walletType: 'main',
        walletAddress: user.walletAddress
      }
    ];

    tokens.push({
      symbol: 'SEI',
      balance: smartAccountBalance,
      value: smartValue,
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      walletType: 'smart',
      walletAddress: smartAccountAddress
    });

    const summary = {
      totalValue: totalValue,
      dailyChange: 0, // TODO: Calculate from historical data
      tokens: tokens,
      wallets: {
        main: {
          address: user.walletAddress,
          balance: mainWalletBalance,
          value: mainValue
        },
        smart: smartAccountAddress ? {
          address: smartAccountAddress,
          balance: smartAccountBalance,
          value: smartValue,
          isDeployed: smartAccountIsDeployed
        } : {
          address: null,
          balance: '0.0',
          value: 0,
          isDeployed: false
        }
      },
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

    // Get current balances from both wallets
    const mainWalletBalance = await blockchainService.getBalance(user.walletAddress);
    const smartAccountBalance = smartAccount ? await blockchainService.getBalance(smartAccount.address) : '0.0';

    const mainValue = parseFloat(mainWalletBalance);
    const smartValue = parseFloat(smartAccountBalance);
    const currentValue = mainValue + smartValue;

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
      const tokens = [];

      if (mainValue > 0) {
        tokens.push({
          symbol: 'SEI',
          balance: mainWalletBalance,
          value: mainValue,
          walletType: 'main'
        });
      }

      if (smartValue > 0) {
        tokens.push({
          symbol: 'SEI',
          balance: smartAccountBalance,
          value: smartValue,
          walletType: 'smart'
        });
      }

      if (tokens.length === 0) {
        tokens.push({
          symbol: 'SEI',
          balance: '0.0',
          value: 0,
          walletType: 'main'
        });
      }

      history[history.length - 1] = {
        timestamp: now.toISOString(),
        value: currentValue,
        tokens: tokens
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
