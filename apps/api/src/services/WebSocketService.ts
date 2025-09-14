import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import OracleService, { PriceData } from './OracleService';
import MarketDataService from './MarketDataService';

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

export interface WebSocketEvents {
  // Client -> Server
  'subscribe:prices': (symbols: string[]) => void;
  'subscribe:strategies': (strategyIds: string[]) => void;
  'subscribe:portfolio': (userId: string) => void;
  'create:alert': (alert: Omit<PriceAlert, 'id' | 'createdAt'>) => void;
  'execute:strategy': (strategyId: string) => void;
  
  // Server -> Client
  'price:update': (data: { symbol: string; price: PriceData }) => void;
  'strategy:update': (data: { strategyId: string; status: string; result?: any }) => void;
  'portfolio:update': (data: { userId: string; portfolio: any }) => void;
  'alert:triggered': (alert: PriceAlert & { currentPrice: number }) => void;
  'transaction:confirmed': (data: { hash: string; status: string; receipt?: any }) => void;
  'notification': (data: { type: string; message: string; data?: any }) => void;
}

export class WebSocketService {
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
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.info(`🔗 Client connected: ${socket.id}`);

      // Authentication check (optional)
      socket.on('authenticate', (data: { userId?: string; address?: string; token?: string }) => {
        try {
          // TODO: Verify JWT token if provided
          const subscription: ClientSubscription = {
            userId: data.userId,
            address: data.address,
            symbols: [],
            strategies: [],
            notifications: true
          };

          this.connectedClients.set(socket.id, subscription);
          socket.emit('authenticated', { success: true });
          logger.info(`✅ Client authenticated: ${data.userId || data.address || socket.id}`);

        } catch (error) {
          socket.emit('authentication:error', { error: 'Invalid authentication' });
          logger.error('❌ Authentication failed:', error);
        }
      });

      // Price subscription
      socket.on('subscribe:prices', (symbols: string[]) => {
        try {
          const subscription = this.connectedClients.get(socket.id);
          if (subscription) {
            subscription.symbols = [...new Set([...subscription.symbols, ...symbols])];
            this.connectedClients.set(socket.id, subscription);
            
            // Join price rooms
            symbols.forEach(symbol => {
              socket.join(`price:${symbol.toUpperCase()}`);
            });

            socket.emit('subscription:confirmed', { type: 'prices', symbols });
            logger.info(`📊 Client ${socket.id} subscribed to prices: ${symbols.join(', ')}`);
          }
        } catch (error) {
          socket.emit('subscription:error', { error: 'Failed to subscribe to prices' });
          logger.error('❌ Price subscription error:', error);
        }
      });

      // Strategy subscription
      socket.on('subscribe:strategies', (strategyIds: string[]) => {
        try {
          const subscription = this.connectedClients.get(socket.id);
          if (subscription) {
            subscription.strategies = [...new Set([...subscription.strategies, ...strategyIds])];
            this.connectedClients.set(socket.id, subscription);
            
            // Join strategy rooms
            strategyIds.forEach(strategyId => {
              socket.join(`strategy:${strategyId}`);
            });

            socket.emit('subscription:confirmed', { type: 'strategies', strategyIds });
            logger.info(`🎯 Client ${socket.id} subscribed to strategies: ${strategyIds.join(', ')}`);
          }
        } catch (error) {
          socket.emit('subscription:error', { error: 'Failed to subscribe to strategies' });
          logger.error('❌ Strategy subscription error:', error);
        }
      });

      // Portfolio subscription
      socket.on('subscribe:portfolio', (userId: string) => {
        try {
          socket.join(`portfolio:${userId}`);
          socket.emit('subscription:confirmed', { type: 'portfolio', userId });
          logger.info(`👤 Client ${socket.id} subscribed to portfolio: ${userId}`);
        } catch (error) {
          socket.emit('subscription:error', { error: 'Failed to subscribe to portfolio' });
          logger.error('❌ Portfolio subscription error:', error);
        }
      });

      // Create price alert
      socket.on('create:alert', async (alertData: Omit<PriceAlert, 'id' | 'createdAt'>) => {
        try {
          const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const alert: PriceAlert = {
            id: alertId,
            ...alertData,
            createdAt: new Date()
          };

          this.priceAlerts.set(alertId, alert);
          socket.emit('alert:created', { alertId, alert });
          logger.info(`🚨 Price alert created: ${alert.symbol} ${alert.condition} $${alert.targetPrice}`);

        } catch (error) {
          socket.emit('alert:error', { error: 'Failed to create price alert' });
          logger.error('❌ Alert creation error:', error);
        }
      });

      // Manual strategy execution request
      socket.on('execute:strategy', (strategyId: string) => {
        try {
          // Emit to strategy execution service (would be implemented)
          this.io.to(`strategy:${strategyId}`).emit('strategy:execute', { strategyId, triggeredBy: socket.id });
          logger.info(`🚀 Manual strategy execution requested: ${strategyId}`);
        } catch (error) {
          socket.emit('execution:error', { error: 'Failed to execute strategy' });
          logger.error('❌ Strategy execution error:', error);
        }
      });

      // Unsubscribe from prices
      socket.on('unsubscribe:prices', (symbols: string[]) => {
        try {
          const subscription = this.connectedClients.get(socket.id);
          if (subscription) {
            subscription.symbols = subscription.symbols.filter(s => !symbols.includes(s));
            this.connectedClients.set(socket.id, subscription);
            
            symbols.forEach(symbol => {
              socket.leave(`price:${symbol.toUpperCase()}`);
            });

            socket.emit('unsubscription:confirmed', { type: 'prices', symbols });
          }
        } catch (error) {
          logger.error('❌ Price unsubscription error:', error);
        }
      });

      // Client disconnect
      socket.on('disconnect', (reason) => {
        this.connectedClients.delete(socket.id);
        logger.info(`🔌 Client disconnected: ${socket.id} (${reason})`);
      });

      // Send initial connection info
      socket.emit('connected', {
        socketId: socket.id,
        timestamp: new Date(),
        serverVersion: '1.0.0'
      });
    });
  }

  /**
   * Start periodic price updates for subscribed symbols
   */
  private startPriceUpdates(): void {
    this.priceUpdateInterval = setInterval(async () => {
      try {
        // Get all unique symbols from subscribed clients
        const allSymbols = new Set<string>();
        for (const subscription of this.connectedClients.values()) {
          subscription.symbols.forEach(symbol => allSymbols.add(symbol.toUpperCase()));
        }

        if (allSymbols.size === 0) return;

        // Fetch prices for all subscribed symbols
        const prices = await this.oracleService.getPrices(Array.from(allSymbols));

        // Emit price updates to subscribers
        for (const [symbol, priceData] of Object.entries(prices)) {
          if (priceData) {
            this.io.to(`price:${symbol}`).emit('price:update', {
              symbol,
              price: priceData
            });

            // Check price alerts
            await this.checkPriceAlerts(symbol, priceData.price);
          }
        }

      } catch (error) {
        logger.error('❌ Error in price updates:', error);
      }
    }, 5000); // Update every 5 seconds
  }

  /**
   * Start periodic market data updates
   */
  private startMarketUpdates(): void {
    this.marketUpdateInterval = setInterval(async () => {
      try {
        // Get market overview and emit to all connected clients
        const marketOverview = await this.marketDataService.getMarketOverview();
        
        this.io.emit('market:overview', {
          timestamp: new Date(),
          data: marketOverview
        });

      } catch (error) {
        logger.error('❌ Error in market updates:', error);
      }
    }, 60000); // Update every minute
  }

  /**
   * Check and trigger price alerts
   */
  private async checkPriceAlerts(symbol: string, currentPrice: number): Promise<void> {
    for (const alert of this.priceAlerts.values()) {
      if (!alert.isActive || alert.symbol.toUpperCase() !== symbol.toUpperCase()) {
        continue;
      }

      let triggered = false;
      if (alert.condition === 'above' && currentPrice > alert.targetPrice) {
        triggered = true;
      } else if (alert.condition === 'below' && currentPrice < alert.targetPrice) {
        triggered = true;
      }

      if (triggered) {
        // Emit alert to user
        this.io.to(`portfolio:${alert.userId}`).emit('alert:triggered', {
          ...alert,
          currentPrice
        });

        // Deactivate alert (one-time trigger)
        alert.isActive = false;
        this.priceAlerts.set(alert.id, alert);

        logger.info(`🚨 Price alert triggered: ${alert.symbol} ${alert.condition} $${alert.targetPrice} (current: $${currentPrice})`);
      }
    }
  }

  /**
   * Broadcast strategy update
   */
  public broadcastStrategyUpdate(strategyId: string, status: string, result?: any): void {
    this.io.to(`strategy:${strategyId}`).emit('strategy:update', {
      strategyId,
      status,
      result,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast portfolio update
   */
  public broadcastPortfolioUpdate(userId: string, portfolio: any): void {
    this.io.to(`portfolio:${userId}`).emit('portfolio:update', {
      userId,
      portfolio,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast transaction confirmation
   */
  public broadcastTransactionUpdate(userId: string, hash: string, status: string, receipt?: any): void {
    this.io.to(`portfolio:${userId}`).emit('transaction:confirmed', {
      hash,
      status,
      receipt,
      timestamp: new Date()
    });
  }

  /**
   * Send notification to specific user
   */
  public sendNotification(userId: string, type: string, message: string, data?: any): void {
    this.io.to(`portfolio:${userId}`).emit('notification', {
      type,
      message,
      data,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast system-wide notification
   */
  public broadcastNotification(type: string, message: string, data?: any): void {
    this.io.emit('notification', {
      type,
      message,
      data,
      timestamp: new Date()
    });
  }

  /**
   * Get service statistics
   */
  public getStats(): {
    connectedClients: number;
    totalSubscriptions: {
      prices: number;
      strategies: number;
    };
    activeAlerts: number;
  } {
    let priceSubscriptions = 0;
    let strategySubscriptions = 0;

    for (const subscription of this.connectedClients.values()) {
      priceSubscriptions += subscription.symbols.length;
      strategySubscriptions += subscription.strategies.length;
    }

    const activeAlerts = Array.from(this.priceAlerts.values()).filter(alert => alert.isActive).length;

    return {
      connectedClients: this.connectedClients.size,
      totalSubscriptions: {
        prices: priceSubscriptions,
        strategies: strategySubscriptions
      },
      activeAlerts
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
  }
}

export default WebSocketService;