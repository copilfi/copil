import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import OracleService from './OracleService';
import MarketDataService from './MarketDataService';
import { BlockchainEvent as StreamBlockchainEvent } from './RedisStreamsService';

export interface ClientSubscription {
  userId?: string;
  address?: string;
  symbols: string[];
  strategies: string[];
  notifications: boolean;
}

export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  condition: 'above' | 'below';
  targetPrice: number;
  isActive: boolean;
  createdAt: Date;
}

export class WebSocketService {
  private static instance: WebSocketService | null = null;
  private io: SocketIOServer;
  private oracleService: OracleService;
  private marketDataService: MarketDataService;
  private connectedClients: Map<string, ClientSubscription> = new Map();
  private priceAlerts: Map<string, PriceAlert> = new Map();
  private priceUpdateInterval?: NodeJS.Timeout;
  private marketUpdateInterval?: NodeJS.Timeout;

  constructor(
    httpServer: HttpServer,
    oracleService: OracleService,
    marketDataService: MarketDataService
  ) {
    this.oracleService = oracleService;
    this.marketDataService = marketDataService;

    // Initialize Socket.IO server
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: env.CORS_ORIGIN || "http://localhost:3000",
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
      },
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
    this.startPriceUpdates();
    this.startMarketUpdates();

    logger.info(`🔌 WebSocket Service initialized on path /socket.io`);

    WebSocketService.instance = this;
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.info(`🔗 Client connected: ${socket.id}`);

      // Authentication check (optional)
      socket.on('authenticate', (data: { userId?: string; address?: string; token?: string }) => {
        try {
          const subscription: ClientSubscription = {
            userId: data.userId,
            address: data.address,
            symbols: [],
            strategies: [],
            notifications: true
          };

          this.connectedClients.set(socket.id, subscription);
          logger.info(`✅ Client authenticated: ${socket.id}`);

          socket.emit('authenticated', { success: true });
        } catch (error) {
          logger.error('Authentication failed:', error);
          socket.emit('authenticated', { success: false, error: 'Authentication failed' });
        }
      });

      socket.on('disconnect', () => {
        logger.info(`🔌 Client disconnected: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });

      // Price subscription
      socket.on('subscribe_prices', (data: { tokens: string[] }) => {
        const subscription = this.connectedClients.get(socket.id);
        if (subscription) {
          subscription.symbols = data.tokens || [];
          logger.info(`📊 Client ${socket.id} subscribed to prices: ${data.tokens?.join(', ')}`);
        }
      });

      // Portfolio subscription
      socket.on('subscribe_portfolio', () => {
        logger.info(`💼 Client ${socket.id} subscribed to portfolio updates`);
      });

      // Transaction subscription
      socket.on('subscribe_transactions', () => {
        logger.info(`💸 Client ${socket.id} subscribed to transaction updates`);
      });
    });
  }

  /**
   * Start real-time price updates
   */
  private startPriceUpdates(): void {
    const PRICE_UPDATE_INTERVAL = 5000; // 5 seconds

    this.priceUpdateInterval = setInterval(async () => {
      try {
        // For now, just send SEI price updates
        // In production, this would fetch from multiple sources
        const seiPriceData = {
          symbol: 'SEI',
          price: 0.45 + (Math.random() - 0.5) * 0.02, // Simulate price movement
          change24h: (Math.random() - 0.5) * 10,
          timestamp: new Date().toISOString()
        };

        // Broadcast to all connected clients
        this.io.emit('priceUpdate', seiPriceData);

        logger.debug(`📊 Price update broadcasted: SEI $${seiPriceData.price.toFixed(4)}`);
      } catch (error) {
        logger.error('Error in price updates:', error);
      }
    }, PRICE_UPDATE_INTERVAL);

    logger.info('📊 Price update service started (5s interval)');
  }

  /**
   * Start real-time market data updates
   */
  private startMarketUpdates(): void {
    const MARKET_UPDATE_INTERVAL = 10000; // 10 seconds

    this.marketUpdateInterval = setInterval(async () => {
      try {
        // Simulate market data
        const marketData = {
          symbol: 'SEI',
          price: 0.45 + (Math.random() - 0.5) * 0.02,
          marketCap: 450000000 + (Math.random() - 0.5) * 10000000,
          volume24h: 12000000 + (Math.random() - 0.5) * 2000000,
          change24h: (Math.random() - 0.5) * 10,
          timestamp: new Date().toISOString()
        };

        // Broadcast market data to connected clients
        this.io.emit('marketUpdate', marketData);

        logger.debug(`📈 Market update broadcasted: SEI market data`);
      } catch (error) {
        logger.error('Error in market updates:', error);
      }
    }, MARKET_UPDATE_INTERVAL);

    logger.info('📈 Market update service started (10s interval)');
  }

  /**
   * Broadcast portfolio update to specific user
   */
  public broadcastPortfolioUpdate(userId: string, portfolioData: any): void {
    // Find user's socket connections
    for (const [socketId, subscription] of this.connectedClients.entries()) {
      if (subscription.userId === userId) {
        this.io.to(socketId).emit('portfolioUpdate', portfolioData);
      }
    }
    logger.debug(`💼 Portfolio update sent to user ${userId}`);
  }

  /**
   * Broadcast transaction update
   */
  public broadcastTransactionUpdate(address: string, transaction: any): void {
    // Find connections for this address
    for (const [socketId, subscription] of this.connectedClients.entries()) {
      if (subscription.address === address) {
        this.io.to(socketId).emit('transactionUpdate', transaction);
      }
    }
    logger.debug(`💸 Transaction update sent to address ${address}`);
  }

  /**
   * Send notification to specific user
   */
  public sendNotification(userId: string, type: string, message: string, data?: any): void {
    for (const [socketId, subscription] of this.connectedClients.entries()) {
      if (subscription.userId === userId && subscription.notifications) {
        this.io.to(socketId).emit('notification', {
          type,
          message,
          data,
          timestamp: new Date()
        });
      }
    }
    logger.debug(`🔔 Notification sent to user ${userId}: ${message}`);
  }

  public notifyUser(userId: string, payload: { type: string; message?: string; data?: any }): void {
    const message = payload.message ?? payload.type;
    this.sendNotification(userId, payload.type, message, payload.data);
  }

  public broadcastBlockchainEvent(event: StreamBlockchainEvent): void {
    this.io.emit('blockchainEvent', event);
  }

  public static notifyUser(userId: string, payload: { type: string; message?: string; data?: any }): void {
    if (!WebSocketService.instance) {
      logger.warn('WebSocketService not initialized; unable to deliver notification', {
        userId,
        payload
      });
      return;
    }

    WebSocketService.instance.notifyUser(userId, payload);
  }

  /**
   * Get service status
   */
  public getStatus() {
    const connectedCount = this.connectedClients.size;
    const activeAlerts = Array.from(this.priceAlerts.values()).filter(alert => alert.isActive);

    return {
      connectedClients: connectedCount,
      priceUpdatesRunning: !!this.priceUpdateInterval,
      marketUpdatesRunning: !!this.marketUpdateInterval,
      activePriceAlerts: activeAlerts.length,
      uptime: process.uptime()
    };
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    if (this.marketUpdateInterval) {
      clearInterval(this.marketUpdateInterval);
    }

    this.io.close();
    logger.info('🔌 WebSocket Service cleaned up');

    if (WebSocketService.instance === this) {
      WebSocketService.instance = null;
    }
  }
}

export default WebSocketService;
