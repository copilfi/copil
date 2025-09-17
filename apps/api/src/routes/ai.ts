import express from 'express';
import { logger } from '@/utils/logger';
import AIAgentService from '@/services/AIAgentService';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';

export function createAIRoutes(aiService: AIAgentService | null) {
  const router = express.Router();

  // Middleware to check AI service availability
  const checkAIService = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (!aiService) {
      return res.status(503).json({
        success: false,
        error: 'AI service is not available. Please try again later.'
      });
    }
    next();
  };

  // Chat with AI agent
  router.post('/chat', authenticateToken, checkAIService, async (req: AuthenticatedRequest, res) => {
    try {
      const { message, sessionId = 'default' } = req.body;
      const userId = req.user!.id;

      if (!message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: message'
        });
      }

      const response = await aiService!.processMessage(userId, message, sessionId);

      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      logger.error('Error processing chat message:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process message'
      });
    }
  });

  // Get chat history
  router.get('/chat/history', authenticateToken, checkAIService, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { limit = 50 } = req.query;

      const history = await aiService!.getChatHistory(userId, parseInt(limit as string));

      res.json({
        success: true,
        data: history,
        count: history.length
      });
    } catch (error) {
      logger.error('Error fetching chat history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch chat history'
      });
    }
  });

  // Clear chat session
  router.delete('/chat/session/:sessionId?', authenticateToken, checkAIService, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { sessionId = 'default' } = req.params;

      aiService!.clearChatSession(userId, sessionId);

      res.json({
        success: true,
        message: 'Chat session cleared'
      });
    } catch (error) {
      logger.error('Error clearing chat session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear chat session'
      });
    }
  });

  // Test intent extraction
  router.post('/intent', authenticateToken, checkAIService, async (req: AuthenticatedRequest, res) => {
    try {
      const { message } = req.body;
      const userId = req.user!.id;

      if (!message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: message'
        });
      }

      const response = await aiService!.processMessage(userId, message, 'intent-test');

      res.json({
        success: true,
        data: {
          originalMessage: message,
          extractedIntent: response.intent,
          confidence: response.confidence,
          canExecute: response.canExecute,
          executionDetails: response.executionDetails
        }
      });
    } catch (error) {
      logger.error('Error extracting intent:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extract intent'
      });
    }
  });

  // Get AI capabilities
  router.get('/capabilities', checkAIService, async (req, res) => {
    try {
      const capabilities = aiService!.getCapabilities();

      res.json({
        success: true,
        data: capabilities
      });
    } catch (error) {
      logger.error('Error fetching AI capabilities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch AI capabilities'
      });
    }
  });

  // AI service health check
  router.get('/health', checkAIService, async (req, res) => {
    try {
      const health = await aiService!.healthCheck();

      res.json({
        success: true,
        data: health
      });
    } catch (error) {
      logger.error('Error checking AI service health:', error);
      res.status(500).json({
        success: false,
        error: 'AI service health check failed'
      });
    }
  });

  // Example trading scenarios for testing
  router.get('/examples', async (req, res) => {
    try {
      const examples = {
        basicSwap: {
          message: "I want to swap 100 SEI for USDC",
          expectedIntent: {
            action: "swap",
            tokenIn: "SEI",
            tokenOut: "USDC", 
            amount: "100"
          }
        },
        conditionalTrade: {
          message: "Buy WETH when price drops below $2000",
          expectedIntent: {
            action: "buy",
            tokenOut: "WETH",
            conditions: [{ type: "price_below", value: "2000" }]
          }
        },
        scheduledTrade: {
          message: "Sell 50 USDC for SEI at 3:30 PM",
          expectedIntent: {
            action: "sell",
            tokenIn: "USDC",
            tokenOut: "SEI",
            amount: "50",
            timeline: "scheduled"
          }
        },
        yieldFarming: {
          message: "Put my SEI into the highest yield farm",
          expectedIntent: {
            action: "yield_farm",
            tokenIn: "SEI"
          }
        },
        portfolioRebalance: {
          message: "Rebalance my portfolio to 50% SEI, 30% USDC, 20% WETH",
          expectedIntent: {
            action: "portfolio_rebalance",
            parameters: {
              allocations: { SEI: 50, USDC: 30, WETH: 20 }
            }
          }
        }
      };

      res.json({
        success: true,
        data: examples
      });
    } catch (error) {
      logger.error('Error fetching examples:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch examples'
      });
    }
  });

  // Execute trading actions directly
  router.post('/execute', authenticateToken, checkAIService, async (req: AuthenticatedRequest, res) => {
    try {
      const { action, parameters } = req.body;
      const userId = req.user!.id;

      if (!action) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: action'
        });
      }

      const result = await aiService!.executeTradingAction(userId, action, parameters || {});

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error executing trading action:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute trading action'
      });
    }
  });

  return router;
}