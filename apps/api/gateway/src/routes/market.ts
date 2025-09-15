import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { optionalAuthMiddleware } from '../middleware/auth';
import axios from 'axios';

const router = express.Router();

router.use(optionalAuthMiddleware);

// Cache for SEI price data to avoid too many API calls
let seiPriceCache: any = null;
let lastCacheUpdate = 0;
const CACHE_DURATION = 180000; // 3 minutes

router.get('/prices', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      message: 'Market prices endpoint - to be implemented',
    },
  });
}));

router.get('/token/sei', asyncHandler(async (_req, res) => {
  try {
    // Check if cache is still valid
    const now = Date.now();
    if (seiPriceCache && (now - lastCacheUpdate) < CACHE_DURATION) {
      return res.json({
        success: true,
        data: seiPriceCache,
      });
    }

    // Fetch fresh data from CoinGecko
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: {
          ids: 'sei-network',
          vs_currencies: 'usd',
          include_24hr_change: 'true',
          include_market_cap: 'true',
          include_24hr_vol: 'true'
        },
        timeout: 10000
      }
    );

    if (!response.data || !response.data['sei-network']) {
      throw new Error('Invalid response from CoinGecko API');
    }

    const seiData = response.data['sei-network'];

    const priceData = {
      symbol: 'SEI',
      name: 'Sei Network',
      price: seiData.usd || 0,
      priceChangePercentage24h: seiData.usd_24h_change || 0,
      marketCap: seiData.usd_market_cap || 0,
      volume24h: seiData.usd_24h_vol || 0,
      lastUpdated: new Date().toISOString()
    };

    // Update cache
    seiPriceCache = priceData;
    lastCacheUpdate = now;

    res.json({
      success: true,
      data: priceData,
    });
  } catch (error) {
    console.error('Error fetching SEI price:', error);

    // If we have cached data, return it even if stale
    if (seiPriceCache) {
      return res.json({
        success: true,
        data: {
          ...seiPriceCache,
          cached: true,
          cacheAge: Date.now() - lastCacheUpdate
        },
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch SEI price data',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

export default router;