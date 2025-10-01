import 'dotenv/config';
import App from './app';
import { logger } from '@/utils/logger';
import { PrismaClient } from '@prisma/client';
import { StrategyExecutionService } from '@/services/StrategyExecutionService';
import blockchainService from '@/services/RealBlockchainService';
import OracleService from '@/services/OracleService';
import MarketDataService from '@/services/MarketDataService';
import WebSocketService from '@/services/WebSocketService';
import AIAgentService from '@/services/AIAgentService';
import DEXAggregationService, { DEXAggregationServiceLike } from '@/services/DEXAggregationService';
import UnavailableDEXAggregationService from '@/services/UnavailableDEXAggregationService';
import EventIndexingService from '@/services/EventIndexingService';
import redisStreamsService from '@/services/RedisStreamsService';
import { DexExecutor, ConditionalOrderEngineContract, SeiProvider } from '@copil/blockchain';

const prisma = new PrismaClient();
import redis from '@/config/redis';
import env from '@/config/env';

let eventIndexingService: EventIndexingService | null = null;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function bootstrap() {
  try {
    logger.info('🚀 Starting Copil DeFi Automation Platform API...');

    // Initialize database connection
    await prisma.$connect();
    logger.info('✅ Database connection established');

    // Initialize Redis connection (optional)
    try {
      await redis.connect();
      logger.info('✅ Redis connection established');
    } catch (error) {
      logger.warn('⚠️  Redis connection failed, continuing without cache:', error);
    }

    // Initialize services
    const oracleService = new OracleService();
    const marketDataService = new MarketDataService();
    let dexService: DEXAggregationServiceLike;
    let dexServiceStatus: { ready: boolean; reason?: string } = {
      ready: false,
      reason: 'DEX aggregation not initialized'
    };
    blockchainService.registerMarketDataService(marketDataService);

    try {
      const automationPrivateKey = env.AUTOMATION_PRIVATE_KEY || env.PRIVATE_KEY;
      if (!automationPrivateKey) {
        throw new Error('Automation key not configured');
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
          entryPoint: env.ENTRY_POINT_ADDRESS || ZERO_ADDRESS,
          conditionalOrderEngine: env.CONDITIONAL_ORDER_ENGINE_ADDRESS || ZERO_ADDRESS
        }
      }, automationPrivateKey);

      const conditionalOrderEngine = new ConditionalOrderEngineContract(
        seiProvider,
        env.CONDITIONAL_ORDER_ENGINE_ADDRESS || ZERO_ADDRESS
      );

      const dexExecutor = new DexExecutor(seiProvider, conditionalOrderEngine);
      dexService = new DEXAggregationService(dexExecutor);
      dexServiceStatus = dexService.getStatus();
      logger.info('✅ DEX aggregation service initialized for AI agent');
    } catch (dexError) {
      const reason = dexError instanceof Error ? dexError.message : 'Unknown initialization error';
      dexService = new UnavailableDEXAggregationService(`DEX aggregation unavailable: ${reason}`);
      dexServiceStatus = dexService.getStatus();
      logger.warn('⚠️ DEX aggregation service unavailable for AI agent:', dexError);
    }

    // Initialize AI Agent Service
    const aiAgentService = new AIAgentService(prisma);
    await aiAgentService.initialize();
    
    // Initialize Strategy Execution Service
    const strategyExecutionService = new StrategyExecutionService(prisma, blockchainService);
    await strategyExecutionService.initialize();

    // Create and start the application
    const app = new App();
    
    // Initialize WebSocket service with HTTP server
    const webSocketService = new WebSocketService(
      app.server,
      oracleService,
      marketDataService
    );

    eventIndexingService = new EventIndexingService({
      prisma,
      provider: blockchainService.getProvider(),
      redisService: redisStreamsService,
      webSocketService
    });
    await eventIndexingService.start();

    // Store services for access from routes
    app.express.locals.services = {
      oracleService,
      marketDataService,
      webSocketService,
      strategyExecutionService,
      blockchainService,
      aiAgentService,
      dexService,
      dexServiceStatus,
      eventIndexingService
    };

    // Register AI routes after services are initialized
    const { createAIRoutes } = await import('@/routes/ai');
    const aiRoutes = createAIRoutes(aiAgentService);
    app.express.use('/api/ai', aiRoutes);
    
    // Start the server first
    app.listen();
    
    // Add post-initialization test routes
    app.express.post('/api/test-copil', async (req, res) => {
      try {
        const { message } = req.body;
        const response = await aiAgentService.processMessage('test-user', message || 'Hello Copil! Check my SEI balance.');
        res.json({ success: true, data: response });
      } catch (error) {
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    logger.info('✅ Copil API Gateway is ready');
    logger.info('📋 Service Status:');
    logger.info(`   • Environment: ${env.NODE_ENV}`);
    logger.info(`   • Port: ${env.PORT}`);
    logger.info(`   • Database: Connected`);
    logger.info(`   • Redis: ${redis.client.status === 'ready' ? 'Connected' : 'Disconnected'}`);
    logger.info(`   • Strategy Engine: ${strategyExecutionService.isRunning() ? 'Running' : 'Stopped'}`);
    logger.info(`   • AI Agent: ${aiAgentService.isReady() ? 'Ready' : 'Initializing'}`);
    logger.info(`   • DEX Aggregation: ${dexServiceStatus.ready ? 'Initialized' : `Unavailable (${dexServiceStatus.reason ?? 'no reason provided'})`}`);
    logger.info(`   • Oracle Service: Initialized`);
    logger.info(`   • Market Data Service: Initialized`);
    logger.info(`   • WebSocket: Enabled with real-time updates`);
    
  } catch (error) {
    logger.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  logger.info(`📤 Received ${signal}, starting graceful shutdown...`);

  try {
    // Close database connection
    if (eventIndexingService) {
      await eventIndexingService.stop();
    }

    await prisma.$disconnect();
    logger.info('✅ Database connection closed');

    // Close Redis connection
    await redis.disconnect();
    logger.info('✅ Redis connection closed');

    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the application
bootstrap();
