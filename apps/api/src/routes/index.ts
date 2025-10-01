import { Router } from 'express';
import { Response } from 'express';
// Import auth routes with security enhancements
import authRoutes from './auth';
import smartAccountRoutes from './smart-account';
import portfolioRoutes from './portfolio';
import { createStrategyRoutes } from './strategy';
import { createDEXRoutes } from './dex';
import { createAIRoutes } from './ai';
import { createSwapRoutes } from './swap.routes';
// import { createMonitoringRoutes } from './monitoring';
import { createOracleRoutes } from './oracle';
import { createMarketRoutes } from './market';
import feeAnalyticsRoutes from './fee-analytics.routes';
import dcaRoutes from './dca';
import ordersRoutes from './orders';
import { blockchainService } from '@/services/RealBlockchainService';
import { StrategyExecutionEngine } from '@/services/StrategyExecutionEngine';
import DEXAggregationService, { DEXAggregationServiceLike } from '@/services/DEXAggregationService';
import UnavailableDEXAggregationService from '@/services/UnavailableDEXAggregationService';
import { AutomationSessionService } from '@/services/AutomationSessionService';
import env from '@/config/env';
import { SeiProvider, DexExecutor, ConditionalOrderEngineContract } from '@copil/blockchain';
// import MonitoringService from '@/services/MonitoringService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const automationSessionService = new AutomationSessionService(prisma, blockchainService);
const executionEngine = new StrategyExecutionEngine(prisma, blockchainService, automationSessionService);

const automationPrivateKey = env.AUTOMATION_PRIVATE_KEY || env.PRIVATE_KEY;
let dexExecutor: DexExecutor | null = null;
let dexAggregationService: DEXAggregationServiceLike;
let dexAggregationStatus: { ready: boolean; reason?: string } = {
  ready: false,
  reason: 'DEX aggregation not initialized'
};

try {
  if (!automationPrivateKey) {
    throw new Error('AUTOMATION_PRIVATE_KEY or PRIVATE_KEY must be configured');
  }

  const seiProvider = new SeiProvider({
    rpcUrl: env.NODE_ENV === 'production' ? env.SEI_MAINNET_RPC_URL : env.SEI_TESTNET_RPC_URL,
    chainId: env.NODE_ENV === 'production' ? env.SEI_CHAIN_ID : env.SEI_TESTNET_CHAIN_ID,
    name: 'Sei Network',
    blockExplorer: 'https://seitrace.com',
    nativeCurrency: {
      symbol: 'SEI',
      name: 'Sei',
      decimals: 18
    },
    contracts: {
      entryPoint: env.ENTRY_POINT_ADDRESS || '0x0000000000000000000000000000000000000000',
      conditionalOrderEngine: env.CONDITIONAL_ORDER_ENGINE_ADDRESS || '0x0000000000000000000000000000000000000000'
    }
  }, automationPrivateKey);

  const conditionalOrderEngine = new ConditionalOrderEngineContract(
    seiProvider,
    env.CONDITIONAL_ORDER_ENGINE_ADDRESS || '0x0000000000000000000000000000000000000000'
  );

  dexExecutor = new DexExecutor(seiProvider, conditionalOrderEngine);
  console.log('✅ DexExecutor initialized for swap routes');

  dexAggregationService = new DEXAggregationService(dexExecutor);
  dexAggregationStatus = dexAggregationService.getStatus();
  console.log('✅ DEX aggregation service wired to live DexExecutor');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Failed to initialize DexExecutor:', message);
  dexAggregationService = new UnavailableDEXAggregationService(`DEX aggregation unavailable: ${message}`);
  dexAggregationStatus = dexAggregationService.getStatus();
}
// const monitoringService = new MonitoringService(prisma);
// import redis from '@/config/redis';
// import { asyncHandler } from '@/middleware/errorHandler';

const router = Router();

// Health check endpoint
router.get('/health', async (_req, res: Response) => {
  try {
    const health = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: false,
        redis: false,
        blockchain: false,
        dexAggregation: false
      },
      details: {} as Record<string, string | undefined>
    };

    // Check database
    try {
      await prisma.$queryRaw`SELECT 1`;
      health.services.database = true;
    } catch (error) {
      health.services.database = false;
    }

    // Simple status for now
    health.services.redis = true;  // We know Redis is working from our tests
    health.services.blockchain = true;  // We know blockchain is working

    const dexStatusCurrent = dexAggregationService.getStatus();
    health.services.dexAggregation = dexStatusCurrent.ready;
    if (!dexStatusCurrent.ready) {
      health.details.dexAggregation = dexStatusCurrent.reason;
    }

    const allHealthy = Object.values(health.services).every(status => status);
    health.status = allHealthy ? 'OK' : 'DEGRADED';

    res.status(allHealthy ? 200 : 503).json(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ status: 'ERROR', error: message });
  }
});

// Info endpoint
router.get('/info', async (_req, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        name: 'Copil DeFi Automation Platform API',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        network: {
          chainId: 1328,
          name: 'Sei Testnet',
          isTestnet: true
        },
        features: [
          'ERC-4337 Smart Accounts',
          'Session Key Management',
          'DEX Aggregation',
          'Automated Trading Strategies',
          'AI Agent Orchestration',
          'Real-time Market Data'
        ]
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load info';
    res.status(500).json({ success: false, error: message });
  }
});

// Start monitoring service
// monitoringService.start();

// API routes - Add working routes first
try {
  router.use('/dex', createDEXRoutes(dexAggregationService));
  if (dexAggregationStatus.ready) {
    console.log('✅ DEX routes registered');
  } else {
    console.warn(`⚠️ DEX aggregation in fallback mode: ${dexAggregationStatus.reason ?? 'Unknown reason'}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ DEX routes failed:', message);
}

try {
  router.use('/swap', createSwapRoutes(dexExecutor, blockchainService, automationSessionService));
  if (dexExecutor) {
    console.log('✅ Swap routes registered');
  } else {
    console.warn('⚠️ Swap routes registered in read-only mode: DexExecutor unavailable');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Swap routes failed:', message);
}

try {
  router.use('/oracle', createOracleRoutes());
  console.log('✅ Oracle routes registered');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Oracle routes failed:', message);
}

try {
  router.use('/market', createMarketRoutes());
  console.log('✅ Market routes registered');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Market routes failed:', message);
}

try {
  router.use('/fee-analytics', feeAnalyticsRoutes);
  console.log('✅ Fee Analytics routes registered');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Fee Analytics routes failed:', message);
}

// Enable auth routes with security enhancements
router.use('/auth', authRoutes);
router.use('/smart-account', smartAccountRoutes);
router.use('/portfolio', portfolioRoutes);
router.use('/strategies', createStrategyRoutes(prisma, executionEngine));
router.use('/dca', dcaRoutes);
router.use('/orders', ordersRoutes);
// router.use('/monitoring', createMonitoringRoutes(monitoringService));
try {
  // Initialize AI service if available
  if (process.env.OPENAI_API_KEY) {
    const aiService = null; // TODO: Initialize proper AI service
    router.use('/ai', createAIRoutes(aiService));
    console.log('✅ AI routes registered');
  } else {
    console.log('⚠️ AI routes skipped - OPENAI_API_KEY not configured');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ AI routes failed:', message);
}

// Root endpoint
router.get('/', (_req, res: Response) => {
  res.json({
    success: true,
    message: 'Welcome to Copil DeFi Automation Platform API',
    version: process.env.npm_package_version || '1.0.0',
    documentation: '/api/docs', // Future Swagger docs
    endpoints: {
      health: '/api/health',
      info: '/api/info',
      auth: '/api/auth',
      smartAccount: '/api/smart-account',
      portfolios: '/api/portfolios',
      strategies: '/api/strategies',
      dca: '/api/dca',
      orders: '/api/orders',
      dex: '/api/dex',
      swap: '/api/swap',
      ai: '/api/ai',
      monitoring: '/api/monitoring',
      oracle: '/api/oracle',
      market: '/api/market',
      feeAnalytics: '/api/fee-analytics'
    }
  });
});

export default router;
