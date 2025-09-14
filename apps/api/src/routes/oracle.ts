import express from 'express';
import { logger } from '@/utils/logger';
import OracleService from '@/services/OracleService';

const router = express.Router();

export function createOracleRoutes() {
  // Get current price for a token
  router.get('/price/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const oracleService: OracleService = req.app.locals.services?.oracleService;
      
      if (!oracleService) {
        return res.status(500).json({
          success: false,
          error: 'Oracle service not available'
        });
      }

      const priceData = await oracleService.getPrice(symbol);
      
      if (!priceData) {
        return res.status(404).json({
          success: false,
          error: `Price data not found for ${symbol}`
        });
      }

      res.json({
        success: true,
        data: priceData,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error(`Error fetching price for ${req.params.symbol}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch price data'
      });
    }
  });

  // Get prices for multiple tokens
  router.post('/prices', async (req, res) => {
    try {
      const { symbols } = req.body;
      const oracleService: OracleService = req.app.locals.services?.oracleService;
      
      if (!oracleService) {
        return res.status(500).json({
          success: false,
          error: 'Oracle service not available'
        });
      }

      if (!symbols || !Array.isArray(symbols)) {
        return res.status(400).json({
          success: false,
          error: 'Symbols array is required'
        });
      }

      const prices = await oracleService.getPrices(symbols);

      res.json({
        success: true,
        data: prices,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error fetching multiple prices:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch price data'
      });
    }
  });

  // Check price condition
  router.post('/condition', async (req, res) => {
    try {
      const { symbol, condition, targetPrice, tolerance } = req.body;
      const oracleService: OracleService = req.app.locals.services?.oracleService;
      
      if (!oracleService) {
        return res.status(500).json({
          success: false,
          error: 'Oracle service not available'
        });
      }

      if (!symbol || !condition || !targetPrice) {
        return res.status(400).json({
          success: false,
          error: 'Symbol, condition, and targetPrice are required'
        });
      }

      if (!['above', 'below', 'equal'].includes(condition)) {
        return res.status(400).json({
          success: false,
          error: 'Condition must be one of: above, below, equal'
        });
      }

      const result = await oracleService.checkPriceCondition(
        symbol,
        condition,
        parseFloat(targetPrice),
        tolerance ? parseFloat(tolerance) : undefined
      );

      res.json({
        success: true,
        data: result,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error checking price condition:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check price condition'
      });
    }
  });

  // Get historical prices
  router.get('/history/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { hours = '24' } = req.query;
      const oracleService: OracleService = req.app.locals.services?.oracleService;
      
      if (!oracleService) {
        return res.status(500).json({
          success: false,
          error: 'Oracle service not available'
        });
      }

      const historicalPrices = await oracleService.getHistoricalPrices(
        symbol,
        parseInt(hours as string)
      );

      res.json({
        success: true,
        data: {
          symbol,
          hours: parseInt(hours as string),
          prices: historicalPrices
        },
        timestamp: new Date()
      });

    } catch (error) {
      logger.error(`Error fetching historical prices for ${req.params.symbol}:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch historical price data'
      });
    }
  });

  // Get supported price feeds
  router.get('/feeds', async (req, res) => {
    try {
      const oracleService: OracleService = req.app.locals.services?.oracleService;
      
      if (!oracleService) {
        return res.status(500).json({
          success: false,
          error: 'Oracle service not available'
        });
      }

      const feeds = oracleService.getSupportedFeeds();

      res.json({
        success: true,
        data: feeds,
        count: feeds.length,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error fetching supported feeds:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch supported feeds'
      });
    }
  });

  // Get oracle service health
  router.get('/health', async (req, res) => {
    try {
      const oracleService: OracleService = req.app.locals.services?.oracleService;
      
      if (!oracleService) {
        return res.status(500).json({
          success: false,
          error: 'Oracle service not available'
        });
      }

      const healthStatus = await oracleService.getHealthStatus();

      res.json({
        success: true,
        data: healthStatus,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Error checking oracle health:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check oracle health'
      });
    }
  });

  return router;
}

export default createOracleRoutes;