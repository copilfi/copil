import express from 'express';
import { logger } from '@/utils/logger';
import MarketDataService from '@/services/MarketDataService';

const router = express.Router();

export function createMarketRoutes() {
  // Get token metrics from CoinGecko
  router.get('/token/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      const metrics = await marketDataService.getTokenMetrics(symbol);
      
      if (!metrics) {
        return res.status(404).json({
          success: false,
          error: `Token metrics not found for ${symbol}`
        });
      }

      res.json({
        success: true,
        data: metrics,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error(`Error fetching token metrics for ${req.params.symbol}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch token metrics'
      });
    }
  });

  // Get multiple token prices
  router.post('/prices', async (req, res) => {
    try {
      const { symbols } = req.body;
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      if (!symbols || !Array.isArray(symbols)) {
        return res.status(400).json({
          success: false,
          error: 'Symbols array is required'
        });
      }

      const prices = await marketDataService.getMultipleTokenPrices(symbols);

      res.json({
        success: true,
        data: prices,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error fetching multiple token prices:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch token prices'
      });
    }
  });

  // Get DeFi protocol metrics
  router.get('/protocol/:protocol', async (req, res) => {
    try {
      const { protocol } = req.params;
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      const metrics = await marketDataService.getProtocolMetrics(protocol);
      
      if (!metrics) {
        return res.status(404).json({
          success: false,
          error: `Protocol metrics not found for ${protocol}`
        });
      }

      res.json({
        success: true,
        data: metrics,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error(`Error fetching protocol metrics for ${req.params.protocol}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch protocol metrics'
      });
    }
  });

  // Get SEI ecosystem TVL
  router.get('/sei/tvl', async (req, res) => {
    try {
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      const seiTvl = await marketDataService.getSeiEcosystemTVL();

      res.json({
        success: true,
        data: seiTvl,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error fetching SEI ecosystem TVL:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch SEI ecosystem TVL'
      });
    }
  });

  // Get Fear & Greed Index
  router.get('/sentiment/fear-greed', async (req, res) => {
    try {
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      const fearGreed = await marketDataService.getFearGreedIndex();
      
      if (!fearGreed) {
        return res.status(404).json({
          success: false,
          error: 'Fear & Greed Index not available'
        });
      }

      res.json({
        success: true,
        data: fearGreed,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error fetching Fear & Greed Index:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Fear & Greed Index'
      });
    }
  });

  // Get trending tokens
  router.get('/trending', async (req, res) => {
    try {
      const { limit = '10' } = req.query;
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      const trending = await marketDataService.getTrendingTokens(parseInt(limit as string));

      res.json({
        success: true,
        data: trending,
        count: trending.length,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error fetching trending tokens:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch trending tokens'
      });
    }
  });

  // Get market overview
  router.get('/overview', async (req, res) => {
    try {
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      const overview = await marketDataService.getMarketOverview();

      res.json({
        success: true,
        data: overview,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error fetching market overview:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch market overview'
      });
    }
  });

  // Get market data service health
  router.get('/health', async (req, res) => {
    try {
      const marketDataService: MarketDataService = req.app.locals.services?.marketDataService;
      
      if (!marketDataService) {
        return res.status(500).json({
          success: false,
          error: 'Market data service not available'
        });
      }

      const healthStatus = await marketDataService.getHealthStatus();

      res.json({
        success: true,
        data: healthStatus,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error checking market data service health:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check market data service health'
      });
    }
  });

  return router;
}

export default createMarketRoutes;