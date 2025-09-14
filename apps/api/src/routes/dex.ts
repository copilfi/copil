import express from 'express';
import { logger } from '@/utils/logger';
import DEXAggregationService from '@/services/DEXAggregationService';

const router = express.Router();

export function createDEXRoutes(dexService: DEXAggregationService) {
  // Get best swap quote
  router.post('/quote', async (req, res) => {
    try {
      const {
        tokenIn,
        tokenOut,
        amountIn,
        slippage = 0.5,
        recipient
      } = req.body;

      if (!tokenIn || !tokenOut || !amountIn || !recipient) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: tokenIn, tokenOut, amountIn, recipient'
        });
      }

      const quote = await dexService.getBestQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippage: parseFloat(slippage),
        recipient,
        deadline: req.body.deadline ? parseInt(req.body.deadline) : undefined
      });

      res.json({
        success: true,
        data: quote
      });
    } catch (error) {
      logger.error('Error getting swap quote:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get swap quote'
      });
    }
  });

  // Get supported tokens
  router.get('/tokens', async (req, res) => {
    try {
      const tokens = dexService.getSupportedTokens();
      
      res.json({
        success: true,
        data: tokens,
        count: tokens.length
      });
    } catch (error) {
      logger.error('Error fetching supported tokens:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch supported tokens'
      });
    }
  });

  // Get token info by address or symbol
  router.get('/tokens/:identifier', async (req, res) => {
    try {
      const { identifier } = req.params;
      const token = dexService.getTokenInfo(identifier);

      if (!token) {
        return res.status(404).json({
          success: false,
          error: 'Token not found'
        });
      }

      res.json({
        success: true,
        data: token
      });
    } catch (error) {
      logger.error('Error fetching token info:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch token info'
      });
    }
  });

  // Get supported DEXs
  router.get('/supported', async (req, res) => {
    try {
      const dexs = dexService.getSupportedDEXs();
      
      res.json({
        success: true,
        data: dexs,
        count: dexs.length
      });
    } catch (error) {
      logger.error('Error fetching supported DEXs:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch supported DEXs'
      });
    }
  });

  // Check if trading pair is supported
  router.get('/pairs/:tokenA/:tokenB', async (req, res) => {
    try {
      const { tokenA, tokenB } = req.params;
      const isSupported = await dexService.isPairSupported(tokenA, tokenB);
      
      res.json({
        success: true,
        data: {
          tokenA,
          tokenB,
          isSupported
        }
      });
    } catch (error) {
      logger.error('Error checking pair support:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check pair support'
      });
    }
  });

  // Get swap route preview (without executing)
  router.post('/route', async (req, res) => {
    try {
      const {
        tokenIn,
        tokenOut,
        amountIn,
        slippage = 0.5
      } = req.body;

      if (!tokenIn || !tokenOut || !amountIn) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: tokenIn, tokenOut, amountIn'
        });
      }

      // Use a placeholder recipient for route calculation
      const quote = await dexService.getBestQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippage: parseFloat(slippage),
        recipient: '0x0000000000000000000000000000000000000000'
      });

      // Remove execution route for preview
      const { executionRoute, ...previewData } = quote;

      res.json({
        success: true,
        data: {
          ...previewData,
          route: {
            dex: executionRoute.dex,
            router: executionRoute.router,
            estimatedGas: quote.bestQuote.gasEstimate
          }
        }
      });
    } catch (error) {
      logger.error('Error getting swap route:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get swap route'
      });
    }
  });

  // Health check for DEX services
  router.get('/health', async (req, res) => {
    try {
      const dexs = dexService.getSupportedDEXs();
      const activeDEXs = dexs.filter(d => d.config.isActive);
      
      const health = {
        totalDEXs: dexs.length,
        activeDEXs: activeDEXs.length,
        supportedTokens: dexService.getSupportedTokens().length,
        status: activeDEXs.length > 0 ? 'healthy' : 'degraded'
      };

      res.status(health.status === 'healthy' ? 200 : 503).json({
        success: true,
        data: health
      });
    } catch (error) {
      logger.error('Error checking DEX health:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check DEX health'
      });
    }
  });

  return router;
}