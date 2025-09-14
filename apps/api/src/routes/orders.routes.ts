import { Router } from 'express';
import { OrderController } from '../controllers/OrderController';
import { authenticateToken } from '../middleware/auth';
import { AutomationManager } from '@copil/blockchain';

export const createOrderRoutes = (automationManager: AutomationManager): Router => {
  const router = Router();
  const orderController = new OrderController(automationManager);

  // All order routes require authentication
  router.use(authenticateToken);

  /**
   * @route POST /api/orders/conditional
   * @description Create a new conditional order
   * @body {
   *   orderType: 'LIMIT_BUY' | 'LIMIT_SELL' | 'STOP_LOSS' | 'TAKE_PROFIT',
   *   tokenIn: string,
   *   tokenOut: string,
   *   amountIn: number,
   *   priceTarget?: number,
   *   timeDeadline?: number,
   *   slippage?: number,
   *   protocol?: 'dragonswap' | 'symphony'
   * }
   */
  router.post('/conditional', orderController.createConditionalOrder);

  /**
   * @route GET /api/orders/conditional
   * @description Get user's conditional orders
   */
  router.get('/conditional', orderController.getConditionalOrders);

  /**
   * @route GET /api/orders/conditional/:id
   * @description Get specific conditional order
   */
  router.get('/conditional/:id', orderController.getConditionalOrder);

  /**
   * @route PUT /api/orders/conditional/:id
   * @description Update conditional order
   * @body {
   *   priceTarget?: number,
   *   timeDeadline?: number,
   *   slippage?: number
   * }
   */
  router.put('/conditional/:id', orderController.updateConditionalOrder);

  /**
   * @route DELETE /api/orders/conditional/:id
   * @description Cancel conditional order
   */
  router.delete('/conditional/:id', orderController.cancelConditionalOrder);

  /**
   * @route GET /api/orders/conditional/:id/status
   * @description Get order status and progress
   */
  router.get('/conditional/:id/status', orderController.getOrderStatus);

  return router;
};