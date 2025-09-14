import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { RedisService } from '../services/RedisService';

interface AuthenticatedSocket {
  userId?: string;
  sessionId?: string;
}

export function setupWebSocket(io: SocketIOServer) {
  // Authentication middleware for WebSocket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        sessionId: string;
      };

      // Check if session exists in Redis
      const sessionData = await RedisService.get(`session:${token}`);
      if (!sessionData) {
        return next(new Error('Invalid or expired session'));
      }

      (socket as any).userId = decoded.userId;
      (socket as any).sessionId = decoded.sessionId;
      
      logger.info(`WebSocket connected: ${decoded.userId}`, {
        socketId: socket.id,
        userId: decoded.userId,
      });

      next();
    } catch (error) {
      logger.warn('WebSocket authentication failed:', error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId;
    const sessionId = (socket as any).sessionId;

    // Join user-specific room
    socket.join(`user:${userId}`);
    
    // Join session-specific room
    socket.join(`session:${sessionId}`);

    logger.info(`WebSocket user joined rooms`, {
      socketId: socket.id,
      userId,
      rooms: [`user:${userId}`, `session:${sessionId}`],
    });

    // Handle price feed subscription
    socket.on('subscribe:prices', (tokens: string[]) => {
      try {
        tokens.forEach(token => {
          socket.join(`price:${token}`);
        });
        
        logger.debug(`User subscribed to price feeds`, {
          userId,
          tokens,
        });
        
        socket.emit('subscribed:prices', { tokens });
      } catch (error) {
        logger.error('Price subscription error:', error);
        socket.emit('error', { message: 'Failed to subscribe to prices' });
      }
    });

    // Handle price feed unsubscription
    socket.on('unsubscribe:prices', (tokens: string[]) => {
      try {
        tokens.forEach(token => {
          socket.leave(`price:${token}`);
        });
        
        logger.debug(`User unsubscribed from price feeds`, {
          userId,
          tokens,
        });
        
        socket.emit('unsubscribed:prices', { tokens });
      } catch (error) {
        logger.error('Price unsubscription error:', error);
        socket.emit('error', { message: 'Failed to unsubscribe from prices' });
      }
    });

    // Handle strategy status subscription
    socket.on('subscribe:strategies', () => {
      socket.join(`strategies:${userId}`);
      socket.emit('subscribed:strategies');
    });

    // Handle portfolio updates subscription  
    socket.on('subscribe:portfolio', () => {
      socket.join(`portfolio:${userId}`);
      socket.emit('subscribed:portfolio');
    });

    // Handle transaction updates subscription
    socket.on('subscribe:transactions', () => {
      socket.join(`transactions:${userId}`);
      socket.emit('subscribed:transactions');
    });

    // Handle AI chat messages
    socket.on('ai:message', async (data: { message: string; context?: any }) => {
      try {
        // TODO: Forward to AI agent service
        logger.info(`AI message received from user ${userId}:`, data);
        
        // Placeholder response
        const response = {
          id: Date.now().toString(),
          message: 'AI agent response placeholder',
          timestamp: new Date().toISOString(),
        };
        
        socket.emit('ai:response', response);
      } catch (error) {
        logger.error('AI message handling error:', error);
        socket.emit('error', { message: 'Failed to process AI message' });
      }
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`WebSocket disconnected: ${userId}`, {
        socketId: socket.id,
        userId,
        reason,
      });
    });

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to Copil WebSocket',
      userId,
      timestamp: new Date().toISOString(),
    });
  });

  // Background task to send periodic updates
  setInterval(async () => {
    try {
      // Send price updates (placeholder)
      const mockPriceUpdate = {
        token: 'SEI',
        price: Math.random() * 100,
        change24h: (Math.random() - 0.5) * 10,
        timestamp: new Date().toISOString(),
      };
      
      io.to('price:SEI').emit('price:update', mockPriceUpdate);
    } catch (error) {
      logger.error('Error sending periodic updates:', error);
    }
  }, 10000); // Every 10 seconds

  logger.info('✅ WebSocket server setup completed');
}

// Utility functions to send messages to specific users/rooms
export class WebSocketService {
  private static io: SocketIOServer;

  static setIO(io: SocketIOServer) {
    this.io = io;
  }

  static sendToUser(userId: string, event: string, data: any) {
    if (this.io) {
      this.io.to(`user:${userId}`).emit(event, data);
    }
  }

  static sendPriceUpdate(token: string, priceData: any) {
    if (this.io) {
      this.io.to(`price:${token}`).emit('price:update', priceData);
    }
  }

  static sendStrategyUpdate(userId: string, strategyData: any) {
    if (this.io) {
      this.io.to(`strategies:${userId}`).emit('strategy:update', strategyData);
    }
  }

  static sendTransactionUpdate(userId: string, transactionData: any) {
    if (this.io) {
      this.io.to(`transactions:${userId}`).emit('transaction:update', transactionData);
    }
  }

  static sendPortfolioUpdate(userId: string, portfolioData: any) {
    if (this.io) {
      this.io.to(`portfolio:${userId}`).emit('portfolio:update', portfolioData);
    }
  }
}