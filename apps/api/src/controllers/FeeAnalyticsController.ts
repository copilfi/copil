import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import FeeCollectorService from '../../../../packages/blockchain/src/services/FeeCollectorService';
import { ethers } from 'ethers';
import env from '@/config/env';

export class FeeAnalyticsController {
  private feeCollector: FeeCollectorService;

  constructor() {
    // Initialize fee collector service
    const provider = new ethers.JsonRpcProvider(
      env.NODE_ENV === 'production' 
        ? env.ALCHEMY_SEI_RPC_URL || env.SEI_MAINNET_RPC_URL 
        : env.SEI_TESTNET_RPC_URL
    );

    this.feeCollector = new FeeCollectorService(
      provider,
      env.TREASURY_PRIVATE_KEY || env.AUTOMATION_PRIVATE_KEY!,
      {
        swap: env.SWAP_FEE_PERCENTAGE,
        dcaExecution: env.DCA_FEE_PERCENTAGE,
        conditionalOrder: env.CONDITIONAL_ORDER_FEE_PERCENTAGE,
        aiStrategy: env.AI_STRATEGY_FEE_PERCENTAGE
      }
    );
  }

  /**
   * Get platform revenue statistics
   */
  async getRevenueStats(req: Request, res: Response): Promise<void> {
    try {
      const { startDate, endDate } = req.query;
      
      let timeframe;
      if (startDate && endDate) {
        timeframe = {
          start: new Date(startDate as string).getTime(),
          end: new Date(endDate as string).getTime()
        };
      }

      const stats = this.feeCollector.getRevenueStats(timeframe);
      
      logger.info('Revenue stats requested', { timeframe, stats });
      
      res.json({
        success: true,
        data: stats,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Failed to get revenue stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get revenue statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get fee configuration
   */
  async getFeeConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const config = this.feeCollector.getFeeConfiguration();
      
      res.json({
        success: true,
        data: {
          ...config,
          formattedFees: {
            swap: `${(config.swap * 100).toFixed(2)}%`,
            dcaExecution: `${(config.dcaExecution * 100).toFixed(2)}%`,
            conditionalOrder: `${(config.conditionalOrder * 100).toFixed(2)}%`,
            aiStrategy: `${(config.aiStrategy * 100).toFixed(2)}%`
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get fee configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get fee configuration'
      });
    }
  }

  /**
   * Get treasury balance
   */
  async getTreasuryBalance(req: Request, res: Response): Promise<void> {
    try {
      const balance = await this.feeCollector.getTreasuryBalance();
      const treasuryAddress = this.feeCollector.getTreasuryAddress();
      
      res.json({
        success: true,
        data: {
          address: treasuryAddress,
          ...balance,
          balanceInUSD: parseFloat(balance.native) * 100 // Mock price: 1 ETH = $100
        }
      });
    } catch (error) {
      logger.error('Failed to get treasury balance:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get treasury balance'
      });
    }
  }

  /**
   * Get fee transactions
   */
  async getFeeTransactions(req: Request, res: Response): Promise<void> {
    try {
      const { 
        limit = 50, 
        offset = 0, 
        userAddress, 
        feeType 
      } = req.query;

      let transactions;
      
      if (userAddress) {
        transactions = this.feeCollector.getUserTransactions(userAddress as string);
      } else {
        transactions = this.feeCollector.getTransactions(
          parseInt(limit as string), 
          parseInt(offset as string)
        );
      }

      // Filter by fee type if specified
      if (feeType) {
        transactions = transactions.filter(tx => tx.feeType === feeType);
      }

      // Add formatted timestamps and amounts
      const formattedTransactions = transactions.map(tx => ({
        ...tx,
        formattedTimestamp: new Date(tx.timestamp).toISOString(),
        feeAmountFormatted: `${parseFloat(tx.feeAmount).toFixed(6)} ETH`,
        feePercentageFormatted: `${(this.feeCollector.getFeeConfiguration()[tx.feeType] * 100).toFixed(2)}%`,
        valueInUSD: (parseFloat(tx.feeAmount) * 100).toFixed(2) // Mock: 1 ETH = $100
      }));

      res.json({
        success: true,
        data: {
          transactions: formattedTransactions,
          pagination: {
            total: transactions.length,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            hasMore: transactions.length === parseInt(limit as string)
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get fee transactions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get fee transactions'
      });
    }
  }

  /**
   * Estimate fees for a transaction
   */
  async estimateFees(req: Request, res: Response): Promise<void> {
    try {
      const { amount, feeType, tokenDecimals = 18 } = req.body;

      if (!amount || !feeType) {
        res.status(400).json({
          success: false,
          error: 'Amount and feeType are required'
        });
        return;
      }

      const estimation = this.feeCollector.estimateFees(
        amount,
        feeType,
        parseInt(tokenDecimals)
      );

      res.json({
        success: true,
        data: {
          ...estimation,
          formattedFee: `${parseFloat(estimation.estimatedFee).toFixed(6)} ETH`,
          formattedNet: `${parseFloat(estimation.netAmount).toFixed(6)} ETH`,
          feePercentageFormatted: `${(estimation.feePercentage * 100).toFixed(2)}%`,
          estimatedValueUSD: (parseFloat(estimation.estimatedFee) * 100).toFixed(2) // Mock price
        }
      });
    } catch (error) {
      logger.error('Failed to estimate fees:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to estimate fees'
      });
    }
  }

  /**
   * Export revenue data
   */
  async exportRevenueData(req: Request, res: Response): Promise<void> {
    try {
      const { format = 'json' } = req.query;
      
      const data = this.feeCollector.exportRevenueData(format as 'json' | 'csv');
      
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="copil-revenue-${Date.now()}.csv"`);
        res.send(data);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="copil-revenue-${Date.now()}.json"`);
        res.send(data);
      }
    } catch (error) {
      logger.error('Failed to export revenue data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export revenue data'
      });
    }
  }

  /**
   * Get competitive analysis vs other platforms
   */
  async getCompetitiveAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const { monthlyTransactions = 100 } = req.query;
      const transactions = parseInt(monthlyTransactions as string);
      
      const feeConfig = this.feeCollector.getFeeConfiguration();
      
      // Sample transaction amounts for analysis
      const avgSwapAmount = '100'; // $100 per swap
      const avgDcaAmount = '50';   // $50 per DCA
      const avgConditionalAmount = '200'; // $200 per conditional order
      
      // Calculate Copil monthly costs
      const copilSwapCost = parseFloat(feeConfig.swap.toString()) * parseFloat(avgSwapAmount) * transactions * 0.5; // 50% swaps
      const copilDcaCost = parseFloat(feeConfig.dcaExecution.toString()) * parseFloat(avgDcaAmount) * transactions * 0.3; // 30% DCA
      const copilConditionalCost = parseFloat(feeConfig.conditionalOrder.toString()) * parseFloat(avgConditionalAmount) * transactions * 0.2; // 20% conditional
      
      const copilTotalCost = copilSwapCost + copilDcaCost + copilConditionalCost;
      
      // Competitor costs (monthly subscriptions)
      const competitors = {
        '3commas': { cost: 37, features: 'DCA, Grid, Futures bots' },
        'cryptohopper': { cost: 75, features: 'AI trading, Strategy marketplace' }, // Average of $19-150
        'shrimpy': { cost: 34, features: 'Portfolio rebalancing, Social trading' }, // Average of $19-49
        'pionex': { cost: 0, features: 'Built-in trading bots (but volume fees)' }
      };
      
      const analysis = {
        copil: {
          monthlyCost: copilTotalCost.toFixed(2),
          model: 'Pay-per-use',
          advantages: [
            'No monthly commitment',
            'Decentralized execution',
            'Smart Account integration',
            'SEI-optimized',
            'Only pay for what you use'
          ]
        },
        competitors: Object.entries(competitors).map(([name, data]) => ({
          name,
          monthlyCost: data.cost.toFixed(2),
          model: 'Monthly subscription',
          features: data.features,
          savings: Math.max(0, data.cost - copilTotalCost).toFixed(2)
        })),
        analysis: {
          avgSavingsVsCompetitors: (
            Object.values(competitors).reduce((sum, comp) => sum + comp.cost, 0) / 
            Object.values(competitors).length - copilTotalCost
          ).toFixed(2),
          breakEvenPoint: transactions,
          recommendedFor: copilTotalCost < 30 
            ? 'Light to moderate users' 
            : 'Heavy automation users'
        }
      };

      res.json({
        success: true,
        data: analysis,
        assumptions: {
          monthlyTransactions: transactions,
          avgSwapAmount: `$${avgSwapAmount}`,
          avgDcaAmount: `$${avgDcaAmount}`,
          avgConditionalAmount: `$${avgConditionalAmount}`,
          transactionMix: '50% swaps, 30% DCA, 20% conditional orders'
        }
      });
    } catch (error) {
      logger.error('Failed to get competitive analysis:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get competitive analysis'
      });
    }
  }

  /**
   * Get real-time dashboard data
   */
  async getDashboardData(req: Request, res: Response): Promise<void> {
    try {
      const stats = this.feeCollector.getRevenueStats();
      const balance = await this.feeCollector.getTreasuryBalance();
      const recentTransactions = this.feeCollector.getTransactions(10, 0);
      
      // Calculate growth metrics
      const now = Date.now();
      const yesterday = now - (24 * 60 * 60 * 1000);
      const lastWeek = now - (7 * 24 * 60 * 60 * 1000);
      
      const yesterdayStats = this.feeCollector.getRevenueStats({ start: yesterday, end: now });
      const weeklyStats = this.feeCollector.getRevenueStats({ start: lastWeek, end: now });
      
      const dashboard = {
        summary: {
          totalRevenue: stats.totalFees,
          dailyRevenue: stats.dailyFees,
          monthlyRevenue: stats.monthlyFees,
          treasuryBalance: balance.native,
          totalTransactions: stats.transactionCount,
          avgFeePerTransaction: stats.averageFeePerTransaction
        },
        growth: {
          dailyGrowth: parseFloat(stats.dailyFees) > parseFloat(yesterdayStats.dailyFees) ? 'positive' : 'negative',
          weeklyTransactions: weeklyStats.transactionCount,
          weeklyRevenue: weeklyStats.totalFees
        },
        breakdown: {
          revenueByType: stats.feesByType,
          revenueByTypeFormatted: {
            swap: `${parseFloat(stats.feesByType.swap).toFixed(4)} ETH`,
            dcaExecution: `${parseFloat(stats.feesByType.dcaExecution).toFixed(4)} ETH`,
            conditionalOrder: `${parseFloat(stats.feesByType.conditionalOrder).toFixed(4)} ETH`,
            aiStrategy: `${parseFloat(stats.feesByType.aiStrategy).toFixed(4)} ETH`
          }
        },
        recentActivity: recentTransactions.slice(0, 5).map(tx => ({
          id: tx.id,
          type: tx.feeType,
          amount: `${parseFloat(tx.feeAmount).toFixed(6)} ETH`,
          user: `${tx.userAddress.slice(0, 6)}...${tx.userAddress.slice(-4)}`,
          timestamp: new Date(tx.timestamp).toISOString(),
          valueUSD: `$${(parseFloat(tx.feeAmount) * 100).toFixed(2)}`
        })),
        projections: {
          monthlyProjection: (parseFloat(stats.dailyFees) * 30).toFixed(4),
          yearlyProjection: (parseFloat(stats.dailyFees) * 365).toFixed(4)
        }
      };

      res.json({
        success: true,
        data: dashboard,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to get dashboard data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get dashboard data'
      });
    }
  }
}

export default FeeAnalyticsController;