import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log('🚀 Starting Copil API Gateway...');

    // Basic middleware
    app.use(helmet({ crossOriginEmbedderPolicy: false }));
    app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
    app.use(compression());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(morgan('combined'));

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        service: 'copil-api-gateway',
      });
    });

    // Test endpoints
    app.get('/api/test', (req, res) => {
      res.json({
        success: true,
        message: 'Copil API Gateway is working!',
        timestamp: new Date().toISOString(),
      });
    });

    app.post('/api/test', (req, res) => {
      res.json({
        success: true,
        message: 'POST endpoint working',
        body: req.body,
        timestamp: new Date().toISOString(),
      });
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        available_routes: [
          'GET /health',
          'GET /api/test',
          'POST /api/test'
        ]
      });
    });

    // Error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Error:', err);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
      });
    });

    server.listen(PORT, () => {
      console.log(`✅ Copil API Gateway started successfully!`);
      console.log(`🌐 Server running on http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🩺 Health check: http://localhost:${PORT}/health`);
      console.log(`🧪 Test endpoint: http://localhost:${PORT}/api/test`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down server...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();