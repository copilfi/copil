import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import redis from '@/config/redis';

// Event types for different streams
export interface TransactionEvent {
  userId: string;
  type: 'execute_strategy' | 'process_swap' | 'monitor_price' | 'execute_order';
  data: any;
  timestamp?: string;
}

export interface NotificationEvent {
  userId: string;
  type: 'price_alert' | 'strategy_update' | 'transaction_complete';
  message: string;
  data?: any;
  timestamp?: string;
}

export interface AnalysisEvent {
  type: 'market_analysis' | 'portfolio_rebalance' | 'risk_assessment';
  userId?: string;
  data: any;
  timestamp?: string;
}

export interface BlockchainEvent {
  contractAddress: string;
  eventName: string;
  blockNumber: number;
  transactionHash: string;
  args: Record<string, any>;
  timestamp?: string;
}

class RedisStreamsService {
  private redisClient: Redis;
  private consumers: Map<string, boolean> = new Map();
  
  // Stream names
  private readonly streams = {
    TRANSACTIONS: 'copil:transactions',
    NOTIFICATIONS: 'copil:notifications',
    ANALYSIS: 'copil:analysis',
    BLOCKCHAIN: 'copil:blockchain',
    MARKET_DATA: 'copil:market_data'
  };
  
  // Consumer groups
  private readonly groups = {
    TRANSACTIONS: 'transaction_processors',
    NOTIFICATIONS: 'notification_handlers',
    ANALYSIS: 'analysis_workers',
    BLOCKCHAIN: 'blockchain_indexers',
    MARKET_DATA: 'market_processors'
  };

  constructor() {
    this.redisClient = redis.client;
    this.initializeStreams();
  }

  private async initializeStreams(): Promise<void> {
    try {
      // Create consumer groups for each stream
      for (const [streamKey, streamName] of Object.entries(this.streams)) {
        const groupName = this.groups[streamKey as keyof typeof this.groups];
        
        try {
          await this.redisClient.xgroup('CREATE', streamName, groupName, '$', 'MKSTREAM');
          logger.info(`✅ Created consumer group ${groupName} for stream ${streamName}`);
        } catch (error: any) {
          if (error.message.includes('BUSYGROUP')) {
            logger.info(`Consumer group ${groupName} already exists for stream ${streamName}`);
          } else {
            logger.error(`Failed to create consumer group ${groupName}:`, error);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to initialize Redis Streams:', error);
    }
  }

  /**
   * Add event to transaction stream
   */
  async addTransactionEvent(event: TransactionEvent): Promise<string> {
    try {
      const eventData = {
        ...event,
        timestamp: event.timestamp || new Date().toISOString()
      };
      
      const id = await this.redisClient.xadd(
        this.streams.TRANSACTIONS,
        '*',
        'data', JSON.stringify(eventData)
      );
      
      logger.debug(`Added transaction event to stream: ${id}`);
      return id;
    } catch (error) {
      logger.error('Failed to add transaction event:', error);
      throw error;
    }
  }

  /**
   * Add event to notification stream
   */
  async addNotificationEvent(event: NotificationEvent): Promise<string> {
    try {
      const eventData = {
        ...event,
        timestamp: event.timestamp || new Date().toISOString()
      };
      
      const id = await this.redisClient.xadd(
        this.streams.NOTIFICATIONS,
        '*',
        'data', JSON.stringify(eventData)
      );
      
      logger.debug(`Added notification event to stream: ${id}`);
      return id;
    } catch (error) {
      logger.error('Failed to add notification event:', error);
      throw error;
    }
  }

  /**
   * Add event to analysis stream
   */
  async addAnalysisEvent(event: AnalysisEvent): Promise<string> {
    try {
      const eventData = {
        ...event,
        timestamp: event.timestamp || new Date().toISOString()
      };
      
      const id = await this.redisClient.xadd(
        this.streams.ANALYSIS,
        '*',
        'data', JSON.stringify(eventData)
      );
      
      logger.debug(`Added analysis event to stream: ${id}`);
      return id;
    } catch (error) {
      logger.error('Failed to add analysis event:', error);
      throw error;
    }
  }

  /**
   * Add event to blockchain stream
   */
  async addBlockchainEvent(event: BlockchainEvent): Promise<string> {
    try {
      const eventData = {
        ...event,
        timestamp: event.timestamp || new Date().toISOString()
      };
      
      const id = await this.redisClient.xadd(
        this.streams.BLOCKCHAIN,
        '*',
        'data', JSON.stringify(eventData)
      );
      
      logger.debug(`Added blockchain event to stream: ${id}`);
      return id;
    } catch (error) {
      logger.error('Failed to add blockchain event:', error);
      throw error;
    }
  }

  /**
   * Consume events from transaction stream
   */
  async consumeTransactionEvents(
    consumerName: string,
    handler: (event: TransactionEvent) => Promise<void>
  ): Promise<void> {
    const consumerKey = `transactions:${consumerName}`;
    
    if (this.consumers.get(consumerKey)) {
      logger.warn(`Consumer ${consumerName} is already running for transactions`);
      return;
    }

    this.consumers.set(consumerKey, true);
    logger.info(`🚀 Started transaction event consumer: ${consumerName}`);

    while (this.consumers.get(consumerKey)) {
      try {
        const results = await this.redisClient.xreadgroup(
          'GROUP', this.groups.TRANSACTIONS, consumerName,
          'COUNT', '10',
          'BLOCK', '1000',
          'STREAMS', this.streams.TRANSACTIONS, '>'
        );

        if (results && results.length > 0) {
          const [streamName, messages] = results[0];
          
          for (const [messageId, fields] of messages) {
            try {
              const eventData = JSON.parse(fields[1]) as TransactionEvent;
              await handler(eventData);
              
              // Acknowledge processed message
              await this.redisClient.xack(this.streams.TRANSACTIONS, this.groups.TRANSACTIONS, messageId);
              
              logger.debug(`Processed transaction event: ${messageId}`);
            } catch (error) {
              logger.error(`Failed to process transaction event ${messageId}:`, error);
            }
          }
        }
      } catch (error) {
        logger.error(`Error in transaction consumer ${consumerName}:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
      }
    }
    
    logger.info(`Stopped transaction event consumer: ${consumerName}`);
  }

  /**
   * Consume events from blockchain stream
   */
  async consumeBlockchainEvents(
    consumerName: string,
    handler: (event: BlockchainEvent) => Promise<void>
  ): Promise<void> {
    const consumerKey = `blockchain:${consumerName}`;
    
    if (this.consumers.get(consumerKey)) {
      logger.warn(`Consumer ${consumerName} is already running for blockchain events`);
      return;
    }

    this.consumers.set(consumerKey, true);
    logger.info(`🚀 Started blockchain event consumer: ${consumerName}`);

    while (this.consumers.get(consumerKey)) {
      try {
        const results = await this.redisClient.xreadgroup(
          'GROUP', this.groups.BLOCKCHAIN, consumerName,
          'COUNT', '20',
          'BLOCK', '1000',
          'STREAMS', this.streams.BLOCKCHAIN, '>'
        );

        if (results && results.length > 0) {
          const [streamName, messages] = results[0];
          
          for (const [messageId, fields] of messages) {
            try {
              const eventData = JSON.parse(fields[1]) as BlockchainEvent;
              await handler(eventData);
              
              // Acknowledge processed message
              await this.redisClient.xack(this.streams.BLOCKCHAIN, this.groups.BLOCKCHAIN, messageId);
              
              logger.debug(`Processed blockchain event: ${messageId}`);
            } catch (error) {
              logger.error(`Failed to process blockchain event ${messageId}:`, error);
            }
          }
        }
      } catch (error) {
        logger.error(`Error in blockchain consumer ${consumerName}:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    logger.info(`Stopped blockchain event consumer: ${consumerName}`);
  }

  /**
   * Stop a specific consumer
   */
  stopConsumer(streamType: 'transactions' | 'blockchain', consumerName: string): void {
    const consumerKey = `${streamType}:${consumerName}`;
    this.consumers.set(consumerKey, false);
    logger.info(`Stopping consumer: ${consumerKey}`);
  }

  /**
   * Stop all consumers
   */
  stopAllConsumers(): void {
    for (const [consumerKey] of this.consumers) {
      this.consumers.set(consumerKey, false);
    }
    logger.info('Stopping all Redis Stream consumers');
  }

  /**
   * Get stream information
   */
  async getStreamInfo(streamName: keyof typeof this.streams): Promise<any> {
    try {
      const info = await this.redisClient.xinfo('STREAM', this.streams[streamName]);
      return info;
    } catch (error) {
      logger.error(`Failed to get stream info for ${streamName}:`, error);
      throw error;
    }
  }

  /**
   * Get pending messages for a consumer group
   */
  async getPendingMessages(streamName: keyof typeof this.streams): Promise<any> {
    try {
      const groupName = this.groups[streamName];
      const pending = await this.redisClient.xpending(this.streams[streamName], groupName);
      return pending;
    } catch (error) {
      logger.error(`Failed to get pending messages for ${streamName}:`, error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to ping Redis
      const pong = await this.redisClient.ping();
      
      // Check if we can read from streams
      for (const streamName of Object.values(this.streams)) {
        try {
          await this.redisClient.xinfo('STREAM', streamName);
        } catch (error: any) {
          if (!error.message.includes('no such key')) {
            throw error;
          }
        }
      }
      
      return pong === 'PONG';
    } catch (error) {
      logger.error('Redis Streams health check failed:', error);
      return false;
    }
  }
}

export const redisStreamsService = new RedisStreamsService();
export default redisStreamsService;