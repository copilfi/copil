import Bull, { Queue, Job, JobOptions } from 'bull';
import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import redis from '@/config/redis';
import env from '@/config/env';

// Job types
export interface TransactionJob {
  userId: string;
  type: 'execute_strategy' | 'process_swap' | 'monitor_price' | 'execute_order';
  data: any;
  retryCount?: number;
}

export interface NotificationJob {
  userId: string;
  type: 'price_alert' | 'strategy_update' | 'transaction_complete';
  message: string;
  data?: any;
}

export interface AnalysisJob {
  type: 'market_analysis' | 'portfolio_rebalance' | 'risk_assessment';
  userId?: string;
  data: any;
}

class QueueService {
  private transactionQueue: Queue<TransactionJob>;
  private notificationQueue: Queue<NotificationJob>;
  private analysisQueue: Queue<AnalysisJob>;
  private schedulerQueue: Queue<any>;
  
  private redisClient: Redis;

  constructor() {
    // Create Redis client for Bull
    this.redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true
    });

    // Initialize queues
    this.transactionQueue = new Bull('transaction-processing', {
      redis: {
        port: parseInt(env.REDIS_URL.split(':')[2] || '6379'),
        host: env.REDIS_URL.split('://')[1].split(':')[0],
      },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.notificationQueue = new Bull('notifications', {
      redis: {
        port: parseInt(env.REDIS_URL.split(':')[2] || '6379'),
        host: env.REDIS_URL.split('://')[1].split(':')[0],
      },
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 1000,
        },
      },
    });

    this.analysisQueue = new Bull('market-analysis', {
      redis: {
        port: parseInt(env.REDIS_URL.split(':')[2] || '6379'),
        host: env.REDIS_URL.split('://')[1].split(':')[0],
      },
      defaultJobOptions: {
        removeOnComplete: 25,
        removeOnFail: 10,
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 5000,
        },
      },
    });

    this.schedulerQueue = new Bull('scheduler', {
      redis: {
        port: parseInt(env.REDIS_URL.split(':')[2] || '6379'),
        host: env.REDIS_URL.split('://')[1].split(':')[0],
      },
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 5,
      },
    });

    this.setupEventHandlers();
    this.setupProcessors();
  }

  private setupEventHandlers(): void {
    // Transaction Queue Events
    this.transactionQueue.on('completed', (job: Job<TransactionJob>, result) => {
      logger.info(`✅ Transaction job ${job.id} completed:`, result);
    });

    this.transactionQueue.on('failed', (job: Job<TransactionJob>, err) => {
      logger.error(`❌ Transaction job ${job.id} failed:`, err);
    });

    this.transactionQueue.on('stalled', (job: Job<TransactionJob>) => {
      logger.warn(`⚠️ Transaction job ${job.id} stalled`);
    });

    // Notification Queue Events
    this.notificationQueue.on('completed', (job: Job<NotificationJob>) => {
      logger.info(`📧 Notification job ${job.id} completed`);
    });

    this.notificationQueue.on('failed', (job: Job<NotificationJob>, err) => {
      logger.error(`❌ Notification job ${job.id} failed:`, err);
    });

    // Analysis Queue Events
    this.analysisQueue.on('completed', (job: Job<AnalysisJob>, result) => {
      logger.info(`📊 Analysis job ${job.id} completed:`, result);
    });

    this.analysisQueue.on('failed', (job: Job<AnalysisJob>, err) => {
      logger.error(`❌ Analysis job ${job.id} failed:`, err);
    });
  }

  private setupProcessors(): void {
    // Transaction Processing
    this.transactionQueue.process('execute_strategy', 5, async (job: Job<TransactionJob>) => {
      return this.processStrategyExecution(job);
    });

    this.transactionQueue.process('process_swap', 10, async (job: Job<TransactionJob>) => {
      return this.processSwapExecution(job);
    });

    this.transactionQueue.process('monitor_price', 20, async (job: Job<TransactionJob>) => {
      return this.processPriceMonitoring(job);
    });

    this.transactionQueue.process('execute_order', 5, async (job: Job<TransactionJob>) => {
      return this.processOrderExecution(job);
    });

    // Notification Processing
    this.notificationQueue.process('price_alert', 50, async (job: Job<NotificationJob>) => {
      return this.processPriceAlert(job);
    });

    this.notificationQueue.process('strategy_update', 25, async (job: Job<NotificationJob>) => {
      return this.processStrategyUpdate(job);
    });

    this.notificationQueue.process('transaction_complete', 25, async (job: Job<NotificationJob>) => {
      return this.processTransactionComplete(job);
    });

    // Analysis Processing
    this.analysisQueue.process('market_analysis', 3, async (job: Job<AnalysisJob>) => {
      return this.processMarketAnalysis(job);
    });

    this.analysisQueue.process('portfolio_rebalance', 2, async (job: Job<AnalysisJob>) => {
      return this.processPortfolioRebalance(job);
    });

    this.analysisQueue.process('risk_assessment', 5, async (job: Job<AnalysisJob>) => {
      return this.processRiskAssessment(job);
    });
  }

  // Transaction Processors
  private async processStrategyExecution(job: Job<TransactionJob>): Promise<any> {
    const { userId, data } = job.data;
    logger.info(`🎯 Processing strategy execution for user ${userId}:`, data);

    try {
      // Implementation will be added when strategy engine is created
      await new Promise(resolve => setTimeout(resolve, 1000)); // Placeholder
      
      return { success: true, userId, strategyId: data.strategyId };
    } catch (error) {
      logger.error('❌ Strategy execution failed:', error);
      throw error;
    }
  }

  private async processSwapExecution(job: Job<TransactionJob>): Promise<any> {
    const { userId, data } = job.data;
    logger.info(`🔄 Processing swap execution for user ${userId}:`, data);

    try {
      // Implementation will be added when DEX service is created
      await new Promise(resolve => setTimeout(resolve, 500)); // Placeholder
      
      return { success: true, userId, swapHash: 'placeholder' };
    } catch (error) {
      logger.error('❌ Swap execution failed:', error);
      throw error;
    }
  }

  private async processPriceMonitoring(job: Job<TransactionJob>): Promise<any> {
    const { userId, data } = job.data;
    logger.info(`📈 Processing price monitoring for user ${userId}:`, data);

    try {
      // Check price conditions and trigger alerts
      const { token, threshold, condition } = data;
      
      // Placeholder for price checking logic
      const currentPrice = Math.random() * 100; // This would be real price data
      
      let shouldTrigger = false;
      if (condition === 'above' && currentPrice > threshold) {
        shouldTrigger = true;
      } else if (condition === 'below' && currentPrice < threshold) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        // Add notification job
        await this.addNotificationJob({
          userId,
          type: 'price_alert',
          message: `${token} price is ${condition} ${threshold}`,
          data: { token, currentPrice, threshold, condition }
        });
      }
      
      return { success: true, userId, token, currentPrice, triggered: shouldTrigger };
    } catch (error) {
      logger.error('❌ Price monitoring failed:', error);
      throw error;
    }
  }

  private async processOrderExecution(job: Job<TransactionJob>): Promise<any> {
    const { userId, data } = job.data;
    logger.info(`📋 Processing order execution for user ${userId}:`, data);

    try {
      // Implementation will be added when conditional order engine is integrated
      await new Promise(resolve => setTimeout(resolve, 800)); // Placeholder
      
      return { success: true, userId, orderId: data.orderId };
    } catch (error) {
      logger.error('❌ Order execution failed:', error);
      throw error;
    }
  }

  // Notification Processors
  private async processPriceAlert(job: Job<NotificationJob>): Promise<any> {
    const { userId, message, data } = job.data;
    logger.info(`🚨 Processing price alert for user ${userId}: ${message}`);

    try {
      // Send WebSocket notification
      await redis.setJSON(`notification:user_${userId}`, {
        type: 'price_alert',
        message,
        data,
        timestamp: new Date().toISOString()
      }, 3600); // 1 hour TTL

      return { success: true, userId, notified: true };
    } catch (error) {
      logger.error('❌ Price alert notification failed:', error);
      throw error;
    }
  }

  private async processStrategyUpdate(job: Job<NotificationJob>): Promise<any> {
    const { userId, message, data } = job.data;
    logger.info(`📊 Processing strategy update for user ${userId}: ${message}`);

    try {
      // Send notification about strategy status change
      await redis.setJSON(`notification:user_${userId}`, {
        type: 'strategy_update',
        message,
        data,
        timestamp: new Date().toISOString()
      }, 3600);

      return { success: true, userId, notified: true };
    } catch (error) {
      logger.error('❌ Strategy update notification failed:', error);
      throw error;
    }
  }

  private async processTransactionComplete(job: Job<NotificationJob>): Promise<any> {
    const { userId, message, data } = job.data;
    logger.info(`✅ Processing transaction complete for user ${userId}: ${message}`);

    try {
      // Send transaction completion notification
      await redis.setJSON(`notification:user_${userId}`, {
        type: 'transaction_complete',
        message,
        data,
        timestamp: new Date().toISOString()
      }, 3600);

      return { success: true, userId, notified: true };
    } catch (error) {
      logger.error('❌ Transaction complete notification failed:', error);
      throw error;
    }
  }

  // Analysis Processors
  private async processMarketAnalysis(job: Job<AnalysisJob>): Promise<any> {
    const { data } = job.data;
    logger.info('📊 Processing market analysis:', data);

    try {
      // Placeholder for market analysis logic
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const analysis = {
        timestamp: new Date().toISOString(),
        market_sentiment: 'bullish', // This would be calculated
        volatility: 0.15,
        recommendations: ['Hold BTC', 'Consider ETH entry point']
      };

      return { success: true, analysis };
    } catch (error) {
      logger.error('❌ Market analysis failed:', error);
      throw error;
    }
  }

  private async processPortfolioRebalance(job: Job<AnalysisJob>): Promise<any> {
    const { userId, data } = job.data;
    logger.info(`⚖️ Processing portfolio rebalance for user ${userId}:`, data);

    try {
      // Placeholder for rebalancing logic
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return { success: true, userId, rebalanced: true };
    } catch (error) {
      logger.error('❌ Portfolio rebalance failed:', error);
      throw error;
    }
  }

  private async processRiskAssessment(job: Job<AnalysisJob>): Promise<any> {
    const { userId, data } = job.data;
    logger.info(`⚠️ Processing risk assessment for user ${userId}:`, data);

    try {
      // Placeholder for risk assessment logic
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const riskScore = Math.random() * 10; // This would be calculated based on portfolio
      
      return { success: true, userId, riskScore, riskLevel: riskScore > 7 ? 'high' : riskScore > 4 ? 'medium' : 'low' };
    } catch (error) {
      logger.error('❌ Risk assessment failed:', error);
      throw error;
    }
  }

  // Public Methods
  async addTransactionJob(job: TransactionJob, options?: JobOptions): Promise<Bull.Job<TransactionJob>> {
    return this.transactionQueue.add(job.type, job, options);
  }

  async addNotificationJob(job: NotificationJob, options?: JobOptions): Promise<Bull.Job<NotificationJob>> {
    return this.notificationQueue.add(job.type, job, options);
  }

  async addAnalysisJob(job: AnalysisJob, options?: JobOptions): Promise<Bull.Job<AnalysisJob>> {
    return this.analysisQueue.add(job.type, job, options);
  }

  async addScheduledJob(name: string, data: any, options: JobOptions): Promise<Bull.Job> {
    return this.schedulerQueue.add(name, data, options);
  }

  // Scheduled Jobs
  async setupRecurringJobs(): Promise<void> {
    // Market analysis every 5 minutes
    await this.schedulerQueue.add('market_analysis', {}, {
      repeat: { cron: '*/5 * * * *' }, // Every 5 minutes
      jobId: 'recurring_market_analysis'
    });

    // Portfolio health check every hour
    await this.schedulerQueue.add('portfolio_health', {}, {
      repeat: { cron: '0 * * * *' }, // Every hour
      jobId: 'recurring_portfolio_health'
    });

    // Risk assessment daily at 8 AM
    await this.schedulerQueue.add('daily_risk_assessment', {}, {
      repeat: { cron: '0 8 * * *' }, // Daily at 8 AM
      jobId: 'daily_risk_assessment'
    });

    logger.info('✅ Recurring jobs scheduled');
  }

  // Queue Management
  async getQueueStats(): Promise<any> {
    const [
      transactionWaiting,
      transactionActive,
      transactionCompleted,
      transactionFailed,
      notificationWaiting,
      notificationActive,
      analysisWaiting,
      analysisActive
    ] = await Promise.all([
      this.transactionQueue.getWaiting(),
      this.transactionQueue.getActive(),
      this.transactionQueue.getCompleted(),
      this.transactionQueue.getFailed(),
      this.notificationQueue.getWaiting(),
      this.notificationQueue.getActive(),
      this.analysisQueue.getWaiting(),
      this.analysisQueue.getActive()
    ]);

    return {
      transaction: {
        waiting: transactionWaiting.length,
        active: transactionActive.length,
        completed: transactionCompleted.length,
        failed: transactionFailed.length
      },
      notification: {
        waiting: notificationWaiting.length,
        active: notificationActive.length
      },
      analysis: {
        waiting: analysisWaiting.length,
        active: analysisActive.length
      }
    };
  }

  async pauseAll(): Promise<void> {
    await Promise.all([
      this.transactionQueue.pause(),
      this.notificationQueue.pause(),
      this.analysisQueue.pause(),
      this.schedulerQueue.pause()
    ]);
    logger.info('⏸️ All queues paused');
  }

  async resumeAll(): Promise<void> {
    await Promise.all([
      this.transactionQueue.resume(),
      this.notificationQueue.resume(),
      this.analysisQueue.resume(),
      this.schedulerQueue.resume()
    ]);
    logger.info('▶️ All queues resumed');
  }

  async closeAll(): Promise<void> {
    await Promise.all([
      this.transactionQueue.close(),
      this.notificationQueue.close(),
      this.analysisQueue.close(),
      this.schedulerQueue.close(),
      this.redisClient.quit()
    ]);
    logger.info('🔒 All queues closed');
  }
}

export const queueService = new QueueService();
export default queueService;