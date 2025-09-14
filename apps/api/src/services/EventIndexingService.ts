import { ethers, Contract } from 'ethers';
import { logger } from '@/utils/logger';
import { prisma } from '@/config/mockDatabase';
import redis from '@/config/redis';
import blockchainService from './BlockchainService';
import env from '@/config/env';
import redisStreamsService, { BlockchainEvent as StreamBlockchainEvent } from './RedisStreamsService';

export interface BlockchainEvent {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  logIndex: number;
  removed: boolean;
}

export interface ProcessedEvent {
  id: string;
  contractAddress: string;
  eventName: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  args: Record<string, any>;
  timestamp: Date;
  processed: boolean;
}

class EventIndexingService {
  private provider: ethers.Provider;
  private isRunning: boolean = false;
  private lastProcessedBlock: number = 0;
  private eventSubscriptions: Map<string, Contract> = new Map();
  private processingQueue: BlockchainEvent[] = [];
  private readonly BATCH_SIZE = 50;
  private readonly BLOCK_RANGE = 100;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      env.NODE_ENV === 'production' ? env.SEI_MAINNET_RPC_URL : env.SEI_TESTNET_RPC_URL
    );
    this.initializeService();
  }

  private async initializeService(): Promise<void> {
    try {
      // Get the last processed block from database
      const lastEvent = await prisma.blockchainEvent.findFirst({
        orderBy: { blockNumber: 'desc' },
        select: { blockNumber: true }
      });

      if (lastEvent) {
        this.lastProcessedBlock = lastEvent.blockNumber;
      } else {
        // Start from current block if no events processed yet
        this.lastProcessedBlock = await this.provider.getBlockNumber();
      }

      logger.info(`📊 Event indexing service initialized. Last processed block: ${this.lastProcessedBlock}`);
    } catch (error) {
      logger.error('❌ Failed to initialize event indexing service:', error);
    }
  }

  /**
   * Start the event indexing service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('⚠️ Event indexing service is already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 Starting event indexing service...');

    // Start historical event processing
    this.processHistoricalEvents();

    // Start real-time event monitoring
    this.startRealTimeMonitoring();

    // Start processing queue
    this.startQueueProcessor();

    logger.info('✅ Event indexing service started');
  }

  /**
   * Stop the event indexing service
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Clear subscriptions
    this.eventSubscriptions.clear();
    
    logger.info('🛑 Event indexing service stopped');
  }

  /**
   * Process historical events in batches
   */
  private async processHistoricalEvents(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      let fromBlock = this.lastProcessedBlock + 1;

      while (fromBlock < currentBlock && this.isRunning) {
        const toBlock = Math.min(fromBlock + this.BLOCK_RANGE - 1, currentBlock);

        logger.info(`📖 Processing historical events from block ${fromBlock} to ${toBlock}`);

        await this.processBlockRange(fromBlock, toBlock);
        
        fromBlock = toBlock + 1;
        this.lastProcessedBlock = toBlock;

        // Save progress
        await redis.set('last_processed_block', toBlock.toString());

        // Small delay to avoid overwhelming the RPC
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info('✅ Historical event processing completed');
    } catch (error) {
      logger.error('❌ Error processing historical events:', error);
    }
  }

  /**
   * Process events in a specific block range
   */
  private async processBlockRange(fromBlock: number, toBlock: number): Promise<void> {
    try {
      const filter = {
        fromBlock,
        toBlock,
        // Monitor our deployed contracts
        address: [
          env.ACCOUNT_FACTORY_ADDRESS,
          env.CONDITIONAL_ORDER_ENGINE_ADDRESS
        ].filter(Boolean) as string[] // Remove undefined addresses
      };

      const logs = await this.provider.getLogs(filter);
      
      for (const log of logs) {
        await this.processEvent({
          address: log.address,
          topics: [...log.topics],
          data: log.data,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          blockHash: log.blockHash,
          logIndex: log.index,
          removed: log.removed
        });
      }

      logger.info(`📝 Processed ${logs.length} events in blocks ${fromBlock}-${toBlock}`);
    } catch (error) {
      logger.error(`❌ Error processing block range ${fromBlock}-${toBlock}:`, error);
    }
  }

  /**
   * Start real-time event monitoring
   */
  private startRealTimeMonitoring(): void {
    // Monitor new blocks
    this.provider.on('block', async (blockNumber: number) => {
      if (!this.isRunning) return;

      try {
        // Process the new block
        await this.processBlockRange(blockNumber, blockNumber);
        this.lastProcessedBlock = blockNumber;
        
        // Update cache
        await redis.set('last_processed_block', blockNumber.toString());
      } catch (error) {
        logger.error(`❌ Error processing block ${blockNumber}:`, error);
      }
    });

    // Set up specific event listeners if contracts are available
    this.setupContractEventListeners();
  }

  /**
   * Set up specific contract event listeners
   */
  private setupContractEventListeners(): void {
    // Account Factory events
    if (env.ACCOUNT_FACTORY_ADDRESS) {
      try {
        const accountFactory = new Contract(
          env.ACCOUNT_FACTORY_ADDRESS,
          [
            'event AccountCreated(address indexed account, address indexed owner, bytes32 indexed salt)',
          ],
          this.provider
        );

        accountFactory.on('AccountCreated', async (account, owner, salt, event) => {
          logger.info(`🏭 Smart Account created: ${account} for owner: ${owner}`);
          
          await this.handleAccountCreatedEvent({
            account,
            owner,
            salt,
            ...event
          });
        });

        this.eventSubscriptions.set('AccountFactory', accountFactory);
      } catch (error) {
        logger.error('❌ Failed to set up AccountFactory event listener:', error);
      }
    }

    // Conditional Order Engine events
    if (env.CONDITIONAL_ORDER_ENGINE_ADDRESS) {
      try {
        const orderEngine = new Contract(
          env.CONDITIONAL_ORDER_ENGINE_ADDRESS,
          [
            'event OrderCreated(uint256 indexed orderId, address indexed user, uint8 orderType)',
            'event OrderExecuted(uint256 indexed orderId, address indexed executor)',
            'event OrderCancelled(uint256 indexed orderId, address indexed user)',
          ],
          this.provider
        );

        orderEngine.on('OrderCreated', async (orderId, user, orderType, event) => {
          logger.info(`📋 Conditional order created: ${orderId} by ${user}`);
          
          await this.handleOrderCreatedEvent({
            orderId,
            user,
            orderType,
            ...event
          });
        });

        orderEngine.on('OrderExecuted', async (orderId, executor, event) => {
          logger.info(`✅ Conditional order executed: ${orderId} by ${executor}`);
          
          await this.handleOrderExecutedEvent({
            orderId,
            executor,
            ...event
          });
        });

        this.eventSubscriptions.set('ConditionalOrderEngine', orderEngine);
      } catch (error) {
        logger.error('❌ Failed to set up ConditionalOrderEngine event listener:', error);
      }
    }
  }

  /**
   * Process a single blockchain event
   */
  private async processEvent(event: BlockchainEvent): Promise<void> {
    try {
      // Get block timestamp
      const block = await this.provider.getBlock(event.blockNumber);
      const timestamp = new Date(block!.timestamp * 1000);

      // Determine event name and decode args
      const { eventName, args } = await this.decodeEvent(event);

      // Save to database
      await prisma.blockchainEvent.upsert({
        where: {
          transactionHash_logIndex: {
            transactionHash: event.transactionHash,
            logIndex: event.logIndex
          }
        },
        update: {
          processed: true,
          processedAt: new Date()
        },
        create: {
          contractAddress: event.address.toLowerCase(),
          eventName,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          args,
          timestamp,
          processed: true,
          processedAt: new Date(),
          blockHash: event.blockHash
        }
      });

      // Emit real-time notification if applicable
      await this.emitRealtimeNotification(eventName, args, event);
      
      // Publish to Redis Streams
      await this.publishToStreams(eventName, args, event, timestamp);

    } catch (error) {
      logger.error('❌ Error processing event:', error);
    }
  }

  /**
   * Decode event based on contract and signature
   */
  private async decodeEvent(event: BlockchainEvent): Promise<{ eventName: string; args: any }> {
    try {
      const eventSignature = event.topics[0];
      
      // Common event signatures
      const eventSignatures: Record<string, { name: string; inputs: any[] }> = {
        '0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235': {
          name: 'AccountCreated',
          inputs: [
            { name: 'account', type: 'address', indexed: true },
            { name: 'owner', type: 'address', indexed: true },
            { name: 'salt', type: 'bytes32', indexed: true }
          ]
        },
        // Add more event signatures as needed
      };

      const eventDef = eventSignatures[eventSignature];
      
      if (eventDef) {
        const iface = new ethers.Interface([
          `event ${eventDef.name}(${eventDef.inputs.map(i => 
            `${i.type}${i.indexed ? ' indexed' : ''} ${i.name}`
          ).join(', ')})`
        ]);
        
        const parsedLog = iface.parseLog({
          topics: event.topics,
          data: event.data
        });

        return {
          eventName: eventDef.name,
          args: parsedLog ? Object.fromEntries(
            Object.entries(parsedLog.args).filter(([key]) => isNaN(Number(key)))
          ) : {}
        };
      }

      return {
        eventName: 'UnknownEvent',
        args: { topics: event.topics, data: event.data }
      };
    } catch (error) {
      logger.error('❌ Error decoding event:', error);
      return {
        eventName: 'DecodeError',
        args: { error: (error as Error).message, topics: event.topics, data: event.data }
      };
    }
  }

  /**
   * Handle AccountCreated event
   */
  private async handleAccountCreatedEvent(eventData: any): Promise<void> {
    try {
      const { account, owner } = eventData;

      // Update user's Smart Account in database
      const user = await prisma.user.findUnique({
        where: { address: owner.toLowerCase() }
      });

      if (user) {
        await prisma.smartAccount.upsert({
          where: { address: account.toLowerCase() },
          update: {
            isActive: true
          },
          create: {
            address: account.toLowerCase(),
            userId: user.id,
            isActive: true
          }
        });

        logger.info(`✅ Smart Account ${account} linked to user ${owner}`);
      }
    } catch (error) {
      logger.error('❌ Error handling AccountCreated event:', error);
    }
  }

  /**
   * Handle OrderCreated event
   */
  private async handleOrderCreatedEvent(eventData: any): Promise<void> {
    try {
      const { orderId, user, orderType } = eventData;

      // Update strategy status if this is related to a strategy
      const strategy = await prisma.strategy.findFirst({
        where: {
          user: { address: user.toLowerCase() },
          status: 'PENDING'
        },
        orderBy: { createdAt: 'desc' }
      });

      if (strategy) {
        await prisma.strategy.update({
          where: { id: strategy.id },
          data: { 
            status: 'ACTIVE',
            conditionalOrderId: orderId.toString()
          }
        });

        logger.info(`✅ Strategy ${strategy.id} activated with order ${orderId}`);
      }
    } catch (error) {
      logger.error('❌ Error handling OrderCreated event:', error);
    }
  }

  /**
   * Handle OrderExecuted event
   */
  private async handleOrderExecutedEvent(eventData: any): Promise<void> {
    try {
      const { orderId, executor } = eventData;

      // Find and update related strategy
      const strategy = await prisma.strategy.findFirst({
        where: { conditionalOrderId: orderId.toString() }
      });

      if (strategy) {
        await prisma.strategy.update({
          where: { id: strategy.id },
          data: { 
            status: 'COMPLETED',
            completedAt: new Date()
          }
        });

        // Create transaction record
        await prisma.transaction.create({
          data: {
            hash: eventData.transactionHash,
            userId: strategy.userId,
            strategyId: strategy.id,
            type: 'STRATEGY_EXECUTION',
            status: 'COMPLETED',
            details: {
              orderId: orderId.toString(),
              executor,
              strategy: strategy.name
            }
          }
        });

        logger.info(`✅ Strategy ${strategy.id} completed via order ${orderId}`);
      }
    } catch (error) {
      logger.error('❌ Error handling OrderExecuted event:', error);
    }
  }

  /**
   * Publish blockchain event to Redis Streams
   */
  private async publishToStreams(eventName: string, args: any, event: BlockchainEvent, timestamp: Date): Promise<void> {
    try {
      const streamEvent: StreamBlockchainEvent = {
        contractAddress: event.address,
        eventName,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        args,
        timestamp: timestamp.toISOString()
      };
      
      await redisStreamsService.addBlockchainEvent(streamEvent);
      
      // Also add to transaction stream if it's a transaction-related event
      if (eventName.includes('Order') || eventName.includes('Swap') || eventName.includes('Transaction')) {
        await redisStreamsService.addTransactionEvent({
          userId: args.user || args.from || 'system',
          type: 'execute_order',
          data: streamEvent
        });
      }
      
      logger.debug(`📡 Published ${eventName} event to Redis Streams`);
    } catch (error) {
      logger.error('❌ Error publishing to Redis Streams:', error);
    }
  }

  /**
   * Emit real-time notification via WebSocket
   */
  private async emitRealtimeNotification(eventName: string, args: any, event: BlockchainEvent): Promise<void> {
    try {
      // This would integrate with the WebSocket server from the main app
      const notificationData = {
        type: 'blockchain_event',
        eventName,
        contractAddress: event.address,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        args,
        timestamp: new Date().toISOString()
      };

      // Cache for WebSocket pickup
      await redis.setJSON(
        `notification:${event.transactionHash}:${event.logIndex}`,
        notificationData,
        60 // 1 minute TTL
      );

      logger.info(`📡 Real-time notification queued for event: ${eventName}`);
    } catch (error) {
      logger.error('❌ Error emitting real-time notification:', error);
    }
  }

  /**
   * Start the queue processor for batching
   */
  private startQueueProcessor(): void {
    setInterval(async () => {
      if (this.processingQueue.length === 0) return;

      const batch = this.processingQueue.splice(0, this.BATCH_SIZE);
      
      try {
        await Promise.all(batch.map(event => this.processEvent(event)));
        logger.info(`✅ Processed batch of ${batch.length} events`);
      } catch (error) {
        logger.error('❌ Error processing event batch:', error);
        // Re-add failed events to queue
        this.processingQueue.unshift(...batch);
      }
    }, 5000); // Process every 5 seconds
  }

  /**
   * Get service status
   */
  getStatus(): {
    isRunning: boolean;
    lastProcessedBlock: number;
    queueSize: number;
    subscriptions: number;
  } {
    return {
      isRunning: this.isRunning,
      lastProcessedBlock: this.lastProcessedBlock,
      queueSize: this.processingQueue.length,
      subscriptions: this.eventSubscriptions.size
    };
  }
}

export const eventIndexingService = new EventIndexingService();
export default eventIndexingService;