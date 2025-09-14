import { logger } from '@/utils/logger';
import { StrategyExecutionEngine } from './StrategyExecutionEngine';
import { PrismaClient } from '@prisma/client';
import { RealBlockchainService } from './RealBlockchainService';

export class StrategyExecutionService {
  private engine: StrategyExecutionEngine;
  private isInitialized: boolean = false;

  constructor(
    private prisma: PrismaClient,
    private blockchainService: RealBlockchainService
  ) {
    this.engine = new StrategyExecutionEngine(prisma, blockchainService);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.engine.start();
      this.isInitialized = true;
      logger.info('✅ Strategy Execution Service initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Strategy Execution Service:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.engine.stop();
      this.isInitialized = false;
      logger.info('✅ Strategy Execution Service shutdown successfully');
    } catch (error) {
      logger.error('❌ Error during Strategy Execution Service shutdown:', error);
    }
  }

  getEngine(): StrategyExecutionEngine {
    return this.engine;
  }

  isRunning(): boolean {
    return this.isInitialized;
  }
}

export default StrategyExecutionService;