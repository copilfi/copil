import { Router } from 'express';
import { DCAController } from '../controllers/DCAController';
import { authenticateToken } from '../middleware/auth';
import { AutomationManager } from '@copil/blockchain';

export const createDCARoutes = (automationManager: AutomationManager): Router => {
  const router = Router();
  const dcaController = new DCAController(automationManager);

  // All DCA routes require authentication
  router.use(authenticateToken);

  /**
   * @route POST /api/dca/strategies
   * @description Create a new DCA strategy
   * @body {
   *   tokenFrom: string,
   *   tokenTo: string,
   *   totalBudget: number,
   *   frequency: 'daily' | 'weekly' | 'monthly' | number,
   *   duration?: number,
   *   protocol?: 'dragonswap' | 'symphony',
   *   slippage?: number
   * }
   */
  router.post('/strategies', dcaController.createDCAStrategy);

  /**
   * @route GET /api/dca/strategies
   * @description Get user's DCA strategies
   */
  router.get('/strategies', dcaController.getDCAStrategies);

  /**
   * @route GET /api/dca/strategies/:id
   * @description Get specific DCA strategy
   */
  router.get('/strategies/:id', dcaController.getDCAStrategy);

  /**
   * @route PUT /api/dca/strategies/:id
   * @description Update DCA strategy (pause/resume)
   * @body {
   *   isActive?: boolean,
   *   slippage?: number
   * }
   */
  router.put('/strategies/:id', dcaController.updateDCAStrategy);

  /**
   * @route DELETE /api/dca/strategies/:id
   * @description Cancel DCA strategy
   */
  router.delete('/strategies/:id', dcaController.deleteDCAStrategy);

  /**
   * @route GET /api/dca/strategies/:id/executions
   * @description Get DCA execution history for a strategy
   */
  router.get('/strategies/:id/executions', dcaController.getDCAExecutionHistory);

  /**
   * @route GET /api/dca/performance
   * @description Get user's overall DCA performance metrics
   */
  router.get('/performance', dcaController.getDCAPerformance);

  return router;
};