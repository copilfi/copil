import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { logger } from './utils/logger';
import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';

// Route imports
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import tradingRoutes from './routes/trading';
import strategyRoutes from './routes/strategy';
import portfolioRoutes from './routes/portfolio';
import aiRoutes from './routes/ai';
import marketRoutes from './routes/market';

// WebSocket setup
import { setupWebSocket } from './websocket';
import { RedisService } from './services/RedisService';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Initialize Redis connection
    await RedisService.connect();
    logger.info('✅ Redis connected successfully');

    // Middleware setup
    app.use(helmet({
      crossOriginEmbedderPolicy: false,
    }));
    
    app.use(cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
    }));
    
    app.use(compression());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Logging
    app.use(morgan('combined', {
      stream: {
        write: (message) => logger.info(message.trim()),
      },
    }));

    // Rate limiting
    app.use('/api/', rateLimiter);

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
      });
    });

    // API routes
    app.use('/api/auth', authRoutes);
    app.use('/api/user', authMiddleware, userRoutes);
    app.use('/api/trading', authMiddleware, tradingRoutes);
    app.use('/api/strategy', authMiddleware, strategyRoutes);
    app.use('/api/portfolio', authMiddleware, portfolioRoutes);
    app.use('/api/ai', authMiddleware, aiRoutes);
    app.use('/api/market', marketRoutes);

    // WebSocket setup
    setupWebSocket(io);

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
      });
    });

    // Global error handler
    app.use(errorHandler);

    server.listen(PORT, () => {
      logger.info(`🚀 API Gateway server started on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🌐 CORS origin: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down server...');
      
      server.close(() => {
        logger.info('✅ Server closed');
      });
      
      await RedisService.disconnect();
      logger.info('✅ Redis disconnected');
      
      process.exit(0);
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();