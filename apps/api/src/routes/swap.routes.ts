import { Router } from 'express';
import { SwapController } from '../controllers/SwapController';
import { authenticateToken } from '../middleware/auth';
import { DexExecutor } from '@copil/blockchain';
import { RealBlockchainService } from '@/services/RealBlockchainService';
import { AutomationSessionService } from '@/services/AutomationSessionService';

export const createSwapRoutes = (
  dexExecutor: DexExecutor | null,
  blockchainService: RealBlockchainService,
  automationSessionService: AutomationSessionService
): Router => {
  const router = Router();
  const swapController = new SwapController(
    dexExecutor,
    blockchainService,
    automationSessionService
  );

  /**
   * @route POST /api/swap/quote
   * @description Get real swap quote from DEX aggregator
   * @body {
   *   tokenIn: string,
   *   tokenOut: string,
   *   amountIn: number,
   *   slippage?: number,
   *   protocol?: 'dragonswap' | 'symphony'
   * }
   */
  router.post('/quote', swapController.getSwapQuote);

  /**
   * @route POST /api/swap/execute
   * @description Execute real swap transaction
   * @requires Authentication
   * @body {
   *   tokenIn: string,
   *   tokenOut: string,
   *   amountIn: number,
   *   amountOutMin?: number,
   *   slippage?: number,
   *   protocol?: 'dragonswap' | 'symphony',
   *   recipient?: string
   * }
   */
  router.post('/execute', authenticateToken, swapController.executeSwap);

  /**
   * @route GET /api/swap/tokens
   * @description Get all supported tokens
   */
  router.get('/tokens', swapController.getSupportedTokens);

  /**
   * @route GET /api/swap/tokens/:identifier
   * @description Get token info by symbol or address
   */
  router.get('/tokens/:identifier', swapController.getTokenInfo);

  /**
   * @route GET /api/swap/tokens/search
   * @description Search tokens by query
   * @query ?q=search_term
   */
  router.get('/tokens/search', swapController.searchTokens);

  /**
   * @route GET /api/swap/protocols
   * @description Get supported DEX protocols
   */
  router.get('/protocols', swapController.getSupportedProtocols);

  return router;
};
