import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';

import env from '@/config/env';
import { logger } from '@/utils/logger';
import { errorHandler, notFound } from '@/middleware/errorHandler';
import routes from '@/routes';

class App {
  public express: express.Application;
  public server: any;

  constructor() {
    this.express = express();
    this.server = createServer(this.express);

    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    // Security middleware
    this.express.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS
    this.express.use(cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Compression
    this.express.use(compression());

    // Rate limiting
    if (env.NODE_ENV !== 'development') {
      const limiter = rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.RATE_LIMIT_MAX_REQUESTS,
        message: {
          error: 'Too many requests from this IP, please try again later',
          retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000)
        },
        standardHeaders: true,
        legacyHeaders: false,
      });

      this.express.use('/api', limiter);
    }

    // Request parsing
    this.express.use(express.json({ limit: '10mb' }));
    this.express.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Logging
    this.express.use(morgan('combined', {
      stream: {
        write: (message: string) => {
          logger.info(message.trim());
        }
      }
    }));

    // Request ID for tracing
    this.express.use((req, res, next) => {
      req.headers['x-request-id'] = req.headers['x-request-id'] || 
        Math.random().toString(36).substring(2, 15);
      res.setHeader('X-Request-ID', req.headers['x-request-id'] as string);
      next();
    });

    // Health check (bypass rate limiting)
    this.express.get('/health', (req, res) => {
      res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
  }

  private initializeRoutes(): void {
    // API routes
    this.express.use('/api', routes);

    // Serve static files in production
    if (env.NODE_ENV === 'production') {
      this.express.use(express.static('public'));
      
      // Catch all handler for SPA
      this.express.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
          res.sendFile('index.html', { root: 'public' });
        }
      });
    }
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.express.use(notFound);

    // Global error handler
    this.express.use(errorHandler);

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      this.server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      this.server.close(() => {
        logger.info('Process terminated');
        process.exit(0);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }


  public listen(): void {
    this.server.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT}`);
      logger.info(`📱 Environment: ${env.NODE_ENV}`);
      logger.info(`🔗 API URL: http://localhost:${env.PORT}/api`);
      logger.info(`📡 WebSocket URL: http://localhost:${env.PORT}`);
    });
  }
}

export default App;
