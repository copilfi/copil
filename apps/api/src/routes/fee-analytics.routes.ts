import { Router } from 'express';
import FeeAnalyticsController from '../controllers/FeeAnalyticsController';
// import { authenticateToken } from '../middleware/auth';
// import { validateRequest } from '../middleware/validation';
import { body, query } from 'express-validator';

const router = Router();
const feeAnalyticsController = new FeeAnalyticsController();

// Validation rules
const estimateFeesValidation = [
  body('amount').isString().notEmpty().withMessage('Amount is required'),
  body('feeType').isIn(['swap', 'dcaExecution', 'conditionalOrder', 'aiStrategy']).withMessage('Invalid fee type'),
  body('tokenDecimals').optional().isInt({ min: 0, max: 18 }).withMessage('Invalid token decimals')
];

const revenueStatsValidation = [
  query('startDate').optional().isISO8601().withMessage('Invalid start date format'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date format')
];

const transactionsValidation = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  query('userAddress').optional().isEthereumAddress().withMessage('Invalid Ethereum address'),
  query('feeType').optional().isIn(['swap', 'dcaExecution', 'conditionalOrder', 'aiStrategy']).withMessage('Invalid fee type')
];

const competitiveAnalysisValidation = [
  query('monthlyTransactions').optional().isInt({ min: 1, max: 10000 }).withMessage('Invalid monthly transactions count')
];

/**
 * @route GET /api/fee-analytics/revenue-stats
 * @desc Get platform revenue statistics
 * @access Private (Admin)
 */
router.get(
  '/revenue-stats',
  async (req, res) => {
    await feeAnalyticsController.getRevenueStats(req, res);
  }
);

/**
 * @route GET /api/fee-analytics/fee-configuration
 * @desc Get current fee configuration
 * @access Public
 */
router.get(
  '/fee-configuration',
  async (req, res) => {
    await feeAnalyticsController.getFeeConfiguration(req, res);
  }
);

/**
 * @route GET /api/fee-analytics/treasury-balance
 * @desc Get treasury wallet balance
 * @access Private (Admin)
 */
router.get(
  '/treasury-balance',
  async (req, res) => {
    await feeAnalyticsController.getTreasuryBalance(req, res);
  }
);

/**
 * @route GET /api/fee-analytics/transactions
 * @desc Get fee transaction history
 * @access Private (Admin or User for their own transactions)
 */
router.get(
  '/transactions',
  async (req, res) => {
    await feeAnalyticsController.getFeeTransactions(req, res);
  }
);

/**
 * @route POST /api/fee-analytics/estimate-fees
 * @desc Estimate fees for a transaction
 * @access Public
 */
router.post(
  '/estimate-fees',
  async (req, res) => {
    await feeAnalyticsController.estimateFees(req, res);
  }
);

/**
 * @route GET /api/fee-analytics/export-revenue
 * @desc Export revenue data (JSON or CSV)
 * @access Private (Admin)
 */
router.get(
  '/export-revenue',
  async (req, res) => {
    await feeAnalyticsController.exportRevenueData(req, res);
  }
);

/**
 * @route GET /api/fee-analytics/competitive-analysis
 * @desc Get competitive analysis vs other platforms
 * @access Public
 */
router.get(
  '/competitive-analysis',
  async (req, res) => {
    await feeAnalyticsController.getCompetitiveAnalysis(req, res);
  }
);

/**
 * @route GET /api/fee-analytics/dashboard
 * @desc Get real-time dashboard data
 * @access Private (Admin)
 */
router.get(
  '/dashboard',
  async (req, res) => {
    await feeAnalyticsController.getDashboardData(req, res);
  }
);

export default router;