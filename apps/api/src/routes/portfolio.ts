import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import Joi from 'joi';
import { logger } from '@/utils/logger';
import { validateBody } from '@/middleware/validation';
import { authenticateToken } from '@/middleware/auth';
import rateLimit from 'express-rate-limit';
import blockchainService from '@/services/RealBlockchainService';
import { CacheService } from '@/services/CacheService';

const router = Router();
const prisma = new PrismaClient();
const cacheService = new CacheService();

const SUMMARY_CACHE_TTL = 30; // seconds
const HISTORY_CACHE_TTL = 60 * 60 * 24; // 24 hours
const HISTORY_MAX_POINTS = 288; // roughly 24h with 5 min granularity
const HISTORY_MIN_INTERVAL_MS = 60 * 1000;

type PortfolioHistoryPoint = {
  timestamp: string;
  value: number;
  mainWalletValue: number;
  smartAccountValue: number;
};

const summaryCacheKey = (userId: string) => `portfolio:summary:${userId}`;
const historyCacheKey = (userId: string) => `portfolio:history:${userId}`;

// Rate limiting for portfolio operations
const portfolioRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many portfolio requests from this IP, please try again later.',
});

router.use(portfolioRateLimit);

type AssetMapEntry = { address: string; symbol: string; name: string };

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

    const forceRefresh = String((req.query?.force as string) || '').toLowerCase() === 'true';
    const cacheKey = summaryCacheKey(userId);

    if (!forceRefresh) {
      const cachedSummary = await cacheService.get<any>(cacheKey, { prefix: 'portfolio' });
      if (cachedSummary) {
        return res.json({
          success: true,
          data: cachedSummary
        });
      }
    }

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

    const dbTokens = await prisma.tokenRegistry.findMany({
      where: { isActive: true }
    });

    const tokenMetadata = new Map<string, AssetMapEntry>();
    const addTokenMetadata = (address?: string | null, symbol?: string | null, name?: string | null) => {
      if (!address || typeof address !== 'string' || !address.toLowerCase().startsWith('0x')) {
        return;
      }

      const normalized = address.toLowerCase();
      if (!tokenMetadata.has(normalized)) {
        tokenMetadata.set(normalized, {
          address,
          symbol: symbol || address,
          name: name || symbol || address
        });
      }
    };

    dbTokens.forEach(token => {
      addTokenMetadata(token.address, token.symbol, token.name);
      if (token.address) {
        blockchainService.registerTokenMetadata(token.address, token.symbol || undefined);
      }
    });

    const trackedTokenAddresses = Array.from(new Set(
      Array.from(tokenMetadata.values())
        .map(entry => entry.address)
    ));

    const mainWalletBalances = await blockchainService.getWalletTokenBalances(
      user.walletAddress,
      trackedTokenAddresses,
      forceRefresh
    );

    const smartAccountBalances = smartAccountAddress
      ? await blockchainService.getWalletTokenBalances(smartAccountAddress, trackedTokenAddresses, forceRefresh)
      : null;

    const mainWalletBalance = mainWalletBalances?.nativeBalance ?? '0.0';
    const smartAccountBalance = smartAccountBalances?.nativeBalance ?? '0.0';

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

    const tokenDetails: Array<{
      symbol: string;
      balance: string;
      value: number;
      valueUsd?: number;
      address: string;
      decimals: number;
      walletType: string;
      walletAddress: string | null;
      priceUsd?: number;
    }> = [];

    const appendTokenDetails = (
      walletBalances: typeof mainWalletBalances | null,
      walletType: 'main' | 'smart',
      walletAddress: string | null
    ) => {
      if (!walletBalances) {
        return;
      }

      walletBalances.tokenBalances.forEach(tokenBalance => {
        const amount = parseFloat(tokenBalance.formattedBalance || '0');
        if (amount <= 0) {
          return;
        }

        tokenDetails.push({
          symbol: tokenBalance.token.symbol || tokenBalance.token.address,
          balance: tokenBalance.formattedBalance,
          value: amount,
          valueUsd: tokenBalance.valueUsd,
          address: tokenBalance.token.address,
          decimals: tokenBalance.token.decimals,
          walletType,
          walletAddress,
          priceUsd: tokenBalance.priceUsd
        });
      });
    };

    appendTokenDetails(mainWalletBalances, 'main', user.walletAddress);
    appendTokenDetails(smartAccountBalances, 'smart', smartAccountAddress);

    const tokens = [
      {
        symbol: 'SEI',
        balance: mainWalletBalance,
        value: mainValue,
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        walletType: 'main',
        walletAddress: user.walletAddress
      },
      {
        symbol: 'SEI',
        balance: smartAccountBalance,
        value: smartValue,
        address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        walletType: 'smart',
        walletAddress: smartAccountAddress
      },
      ...tokenDetails
    ];

    const aggregatedTokens = new Map<string, { address: string; symbol: string; name: string; amount: number }>();

    const recordToken = (
      address: string | null,
      amount: number,
      fallbackSymbol?: string,
      fallbackName?: string
    ) => {
      if (amount <= 0) {
        return;
      }

      const normalizedAddress = address ? address.toLowerCase() : null;
      const metadata = normalizedAddress ? tokenMetadata.get(normalizedAddress) : undefined;

      const entryAddress = metadata?.address || address || fallbackSymbol || 'UNKNOWN';
      const entrySymbol = metadata?.symbol || fallbackSymbol || 'UNKNOWN';
      const entryName = metadata?.name || fallbackName || entrySymbol;
      const mapKey = (metadata?.address || address || entrySymbol).toLowerCase();

      const existing = aggregatedTokens.get(mapKey) || {
        address: entryAddress,
        symbol: entrySymbol,
        name: entryName,
        amount: 0
      };

      existing.amount += amount;
      aggregatedTokens.set(mapKey, existing);
    };

    const addTokenBalances = (walletBalances: typeof mainWalletBalances | null) => {
      if (!walletBalances) {
        return;
      }

      walletBalances.tokenBalances.forEach(tokenBalance => {
        const amount = parseFloat(tokenBalance.formattedBalance || '0');
        if (amount <= 0) {
          return;
        }

        recordToken(
          tokenBalance.token.address || tokenBalance.token.symbol || null,
          amount,
          tokenBalance.token.symbol,
          tokenBalance.token.name
        );
      });
    };

    addTokenBalances(mainWalletBalances);
    addTokenBalances(smartAccountBalances);

    const nativeTotal = parseFloat(mainWalletBalance) + parseFloat(smartAccountBalance);
    if (nativeTotal > 0) {
      recordToken('sei-native', nativeTotal, 'SEI', 'Sei');
    }

    const totalAssetAmount = Array.from(aggregatedTokens.values())
      .reduce((sum, entry) => sum + entry.amount, 0);

    const assetAllocation = Array.from(aggregatedTokens.values())
      .filter(entry => entry.amount > 0)
      .map(entry => ({
        address: entry.address,
        symbol: entry.symbol,
        name: entry.name,
        amount: entry.amount,
        percentage: totalAssetAmount > 0 ? (entry.amount / totalAssetAmount) * 100 : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    const nowIso = new Date().toISOString();
    let historySeries = (await cacheService.get<PortfolioHistoryPoint[]>(historyCacheKey(userId), { prefix: 'portfolio' })) || [];

    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const baselinePoint = historySeries.find(point => new Date(point.timestamp).getTime() >= twentyFourHoursAgo) || historySeries[0];
    const dailyChange = baselinePoint ? totalValue - baselinePoint.value : 0;
    const dailyChangePercentage = baselinePoint && baselinePoint.value !== 0
      ? (dailyChange / baselinePoint.value) * 100
      : 0;

    const summary = {
      totalValue,
      dailyChange,
      dailyChangePercentage,
      tokens,
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
      assetAllocation,
      lastUpdated: nowIso
    };

    const newPoint: PortfolioHistoryPoint = {
      timestamp: nowIso,
      value: totalValue,
      mainWalletValue: mainValue,
      smartAccountValue: smartValue
    };

    if (historySeries.length === 0) {
      historySeries.push(newPoint);
    } else {
      const lastPoint = historySeries[historySeries.length - 1];
      const elapsed = new Date(newPoint.timestamp).getTime() - new Date(lastPoint.timestamp).getTime();
      if (elapsed < HISTORY_MIN_INTERVAL_MS) {
        historySeries[historySeries.length - 1] = newPoint;
      } else {
        historySeries.push(newPoint);
      }
    }

    if (historySeries.length > HISTORY_MAX_POINTS) {
      historySeries = historySeries.slice(historySeries.length - HISTORY_MAX_POINTS);
    }

    await cacheService.set(historyCacheKey(userId), historySeries, {
      prefix: 'portfolio',
      ttl: HISTORY_CACHE_TTL
    });

    await cacheService.set(cacheKey, summary, {
      prefix: 'portfolio',
      ttl: SUMMARY_CACHE_TTL
    });

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
        assetAllocation: [],
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
    const forceRefresh = String((req.query?.force as string) || '').toLowerCase() === 'true';
    logger.info(`Portfolio history requested for user ${userId}, period: ${period}`);

    const smartAccountRecord = await prisma.smartAccount.findFirst({
      where: {
        userId: userId,
        isActive: true
      }
    });

    let smartAccountAddress: string | null = smartAccountRecord?.address || null;

    try {
      const onchainAddress = await blockchainService.getSmartAccountAddress(user.walletAddress);
      if (onchainAddress) {
        smartAccountAddress = onchainAddress;
      }
    } catch (addressError) {
      logger.warn('History address resolution failed:', addressError);
    }

    const now = new Date();

    const historyKey = historyCacheKey(userId);
    const summaryKey = summaryCacheKey(userId);

    let historySeries = await cacheService.get<PortfolioHistoryPoint[]>(historyKey, { prefix: 'portfolio' });

    if (!historySeries || historySeries.length === 0 || forceRefresh) {
      const historyDbTokens = await prisma.tokenRegistry.findMany({
        where: { isActive: true }
      });

      const historyTrackedTokenAddresses: string[] = [];
      historyDbTokens.forEach(token => {
        if (token.address) {
          historyTrackedTokenAddresses.push(token.address);
          blockchainService.registerTokenMetadata(token.address, token.symbol || undefined);
        }
      });

      const mainWalletBalances = await blockchainService.getWalletTokenBalances(
        user.walletAddress,
        historyTrackedTokenAddresses,
        true
      );

      const smartAccountBalances = smartAccountAddress
        ? await blockchainService.getWalletTokenBalances(smartAccountAddress, historyTrackedTokenAddresses, true)
        : null;

      const mainWalletBalance = mainWalletBalances?.nativeBalance ?? '0.0';
      const smartAccountBalance = smartAccountBalances?.nativeBalance ?? '0.0';

      const mainValue = parseFloat(mainWalletBalance);
      const smartValue = parseFloat(smartAccountBalance);
      const currentValue = mainValue + smartValue;

      const seedPoint: PortfolioHistoryPoint = {
        timestamp: now.toISOString(),
        value: currentValue,
        mainWalletValue: mainValue,
        smartAccountValue: smartValue
      };

      historySeries = [seedPoint];

      await cacheService.set(historyKey, historySeries, {
        prefix: 'portfolio',
        ttl: HISTORY_CACHE_TTL
      });

      await cacheService.delete(summaryKey, { prefix: 'portfolio' });
    }

    if (!historySeries) {
      historySeries = [];
    }

    const periodToMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };

    const periodMs = periodToMs[period] || periodToMs['24h'];
    const cutoffTime = now.getTime() - periodMs;

    const filteredHistory = historySeries
      .filter(point => new Date(point.timestamp).getTime() >= cutoffTime)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    logger.info(`Portfolio history: ${filteredHistory.length} data points for period ${period}`);

    res.json({
      success: true,
      data: filteredHistory,
      period,
      startTime: new Date(cutoffTime).toISOString(),
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
