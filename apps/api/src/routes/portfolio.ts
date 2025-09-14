import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import Joi from 'joi';
import { logger } from '@/utils/logger';
import { validateBody } from '@/middleware/validation';
import rateLimit from 'express-rate-limit';

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