import { Contract, EventFragment, EventLog, Interface, JsonRpcProvider, Log, Result } from 'ethers';
import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import { redisStreamsService, BlockchainEvent as StreamBlockchainEvent } from './RedisStreamsService';
import WebSocketService from './WebSocketService';

interface ContractConfig {
  key: string;
  name: string;
  address: string;
  abi: string[];
}

interface ContractMetadata {
  config: ContractConfig;
  contractId: string;
  contract: Contract;
  iface: Interface;
  lastIndexedBlock: number;
  listeners: Map<string, (...args: unknown[]) => void>;
}

interface EventIndexingOptions {
  prisma: PrismaClient;
  provider: JsonRpcProvider;
  redisService?: typeof redisStreamsService;
  webSocketService?: WebSocketService;
}

const ACCOUNT_FACTORY_ABI = [
  'event AccountCreated(address indexed account, address indexed owner, bytes32 indexed salt)'
];

const CONDITIONAL_ORDER_ENGINE_ABI = [
  'event OrderCreated(uint256 indexed orderId, address indexed user, uint8 orderType)',
  'event OrderExecuted(uint256 indexed orderId, address indexed executor)',
  'event OrderCancelled(uint256 indexed orderId, address indexed user)'
];

// Free-tier Alchemy endpoints only allow eth_getLogs windows <= 10 blocks.
// Keep the batch size configurable via env (falls back to 10) so we stay below rate limits.
const BLOCK_RANGE = Number(process.env.EVENT_INDEX_BLOCK_RANGE ?? 10);
const POLL_INTERVAL_MS = 15000;
const BLOCK_CACHE_SIZE = 128;

export class EventIndexingService {
  private readonly prisma: PrismaClient;
  private readonly provider: JsonRpcProvider;
  private readonly redisService: typeof redisStreamsService;
  private webSocketService?: WebSocketService;

  private isRunning = false;
  private isProcessing = false;
  private pollTimer?: NodeJS.Timeout;
  private chainId: number | null = null;

  private readonly contractRegistry: Map<string, ContractMetadata> = new Map();
  private readonly blockTimestampCache: Map<number, Date> = new Map();

  constructor(options: EventIndexingOptions) {
    this.prisma = options.prisma;
    this.provider = options.provider;
    this.redisService = options.redisService ?? redisStreamsService;
    this.webSocketService = options.webSocketService;
  }

  setWebSocketService(service: WebSocketService): void {
    this.webSocketService = service;
  }

  isStarted(): boolean {
    return this.isRunning;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Event indexing service already running');
      return;
    }

    await this.initializeContracts();

    if (this.contractRegistry.size === 0) {
      logger.warn('Event indexing service: no contracts configured, skipping start');
      return;
    }

    this.isRunning = true;

    await this.catchUpHistoricalEvents();
    this.registerRealtimeListeners();
    this.startPolling();

    logger.info('Event indexing service started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    for (const metadata of this.contractRegistry.values()) {
      for (const [eventName, listener] of metadata.listeners.entries()) {
        metadata.contract.off(eventName, listener);
      }
      metadata.listeners.clear();
    }

    this.contractRegistry.clear();
    this.blockTimestampCache.clear();

    logger.info('Event indexing service stopped');
  }

  private async initializeContracts(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      this.chainId = Number(network.chainId);
      const latestBlock = await this.provider.getBlockNumber();

      const configs = this.buildContractConfigs();
      this.contractRegistry.clear();

      for (const config of configs) {
        if (!config.address) {
          continue;
        }

        const normalizedAddress = config.address.toLowerCase();
        const contractRecord = await this.prisma.indexedContract.upsert({
          where: { address: normalizedAddress },
          update: {
            name: config.name,
            chainId: this.chainId,
            isActive: true,
            metadata: {
              key: config.key,
              abiHash: config.abi.join('|')
            }
          },
          create: {
            name: config.name,
            address: normalizedAddress,
            chainId: this.chainId,
            lastIndexedBlock: latestBlock,
            metadata: {
              key: config.key,
              abiHash: config.abi.join('|')
            }
          }
        });

        const contract = new Contract(config.address, config.abi, this.provider);
        const iface = new Interface(config.abi);

        this.contractRegistry.set(normalizedAddress, {
          config,
          contractId: contractRecord.id,
          contract,
          iface,
          lastIndexedBlock: contractRecord.lastIndexedBlock || latestBlock,
          listeners: new Map()
        });
      }

      if (this.contractRegistry.size === 0) {
        logger.warn('Event indexing service initialized without active contracts');
      } else {
        logger.info(
          `Event indexing service initialized with ${this.contractRegistry.size} contract(s); latest block ${latestBlock}`
        );
      }
    } catch (error) {
      logger.error('Failed to initialize event indexing service', error);
    }
  }

  private buildContractConfigs(): ContractConfig[] {
    const configs: ContractConfig[] = [];

    if (env.ACCOUNT_FACTORY_ADDRESS) {
      configs.push({
        key: 'account-factory',
        name: 'AccountFactory',
        address: env.ACCOUNT_FACTORY_ADDRESS,
        abi: ACCOUNT_FACTORY_ABI
      });
    }

    if (env.CONDITIONAL_ORDER_ENGINE_ADDRESS) {
      configs.push({
        key: 'conditional-order-engine',
        name: 'ConditionalOrderEngine',
        address: env.CONDITIONAL_ORDER_ENGINE_ADDRESS,
        abi: CONDITIONAL_ORDER_ENGINE_ABI
      });
    }

    return configs;
  }

  private async catchUpHistoricalEvents(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      const latestBlock = await this.provider.getBlockNumber();

      for (const metadata of this.contractRegistry.values()) {
        let fromBlock = Math.max(metadata.lastIndexedBlock + 1, latestBlock - BLOCK_RANGE);
        if (fromBlock < 0) {
          fromBlock = 0;
        }

        if (fromBlock > latestBlock) {
          continue;
        }

        while (fromBlock <= latestBlock && this.isRunning) {
          const toBlock = Math.min(fromBlock + BLOCK_RANGE - 1, latestBlock);

          logger.info(
            `Event indexing: fetching logs for ${metadata.config.name} blocks ${fromBlock} → ${toBlock}`
          );

          const logs = await this.provider.getLogs({
            address: metadata.config.address,
            fromBlock,
            toBlock
          });

          for (const log of logs) {
            await this.processEventLog(metadata, log);
          }

          metadata.lastIndexedBlock = Math.max(metadata.lastIndexedBlock, toBlock);
          await this.updateLastIndexedBlock(metadata.contractId, metadata.lastIndexedBlock);

          fromBlock = toBlock + 1;
        }
      }
    } catch (error) {
      logger.error('Event indexing: historical catch-up failed', error);
    }
  }

  private registerRealtimeListeners(): void {
    for (const metadata of this.contractRegistry.values()) {
      const eventFragments = metadata.contract.interface.fragments.filter(
        (fragment): fragment is EventFragment => fragment.type === 'event'
      );

      for (const fragment of eventFragments) {
        const eventName = fragment.name;

        const listener = async (...args: unknown[]) => {
          const event = args[args.length - 1] as EventLog | undefined;
          if (!event || !this.isRunning) {
            return;
          }

          try {
            await this.processEventLog(metadata, event);
            metadata.lastIndexedBlock = Math.max(metadata.lastIndexedBlock, event.blockNumber);
            await this.updateLastIndexedBlock(metadata.contractId, metadata.lastIndexedBlock);
          } catch (error) {
            logger.error(`Event indexing: failed to process realtime event ${eventName}`, error);
          }
        };

        metadata.contract.on(eventName, listener);
        metadata.listeners.set(eventName, listener);
      }

      logger.info(`Event indexing: subscribed to realtime events for ${metadata.config.name}`);
    }
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (!this.isRunning || this.isProcessing) {
        return;
      }

      this.isProcessing = true;
      this.catchUpHistoricalEvents()
        .catch(error => {
          logger.error('Event indexing: polling catch-up failed', error);
        })
        .finally(() => {
          this.isProcessing = false;
        });
    }, POLL_INTERVAL_MS);
  }

  private async processEventLog(metadata: ContractMetadata, log: Log | EventLog): Promise<void> {
    const logIndex = typeof log.index === 'number' ? log.index : 0;
    const blockHash = (log as { blockHash?: string }).blockHash ?? '';
    const transactionHash = (log as { transactionHash?: string }).transactionHash ?? '';

    let eventName = 'UnknownEvent';
    let decodedArgs: Record<string, unknown> = {};

    try {
      const parsed = metadata.iface.parseLog(log);
      if (parsed) {
        eventName = parsed.name;
        decodedArgs = this.normalizeArgs(parsed.args);
      }
    } catch (error) {
      logger.warn('Event indexing: failed to decode log', {
        address: log.address,
        topics: log.topics,
        error: error instanceof Error ? error.message : 'unknown'
      });
      decodedArgs = {
        topics: log.topics,
        data: log.data
      };
    }

    const timestamp = await this.getBlockTimestamp(log.blockNumber);

    await this.prisma.blockchainEvent.upsert({
      where: {
        transactionHash_logIndex: {
          transactionHash,
          logIndex
        }
      },
      update: {
        contractId: metadata.contractId,
        eventName,
        blockNumber: log.blockNumber,
        blockHash,
        args: decodedArgs as Prisma.JsonObject,
        timestamp,
        processed: true,
        processedAt: new Date()
      },
      create: {
        contractId: metadata.contractId,
        eventName,
        blockNumber: log.blockNumber,
        transactionHash,
        logIndex,
        blockHash,
        args: decodedArgs as Prisma.JsonObject,
        timestamp,
        processed: true,
        processedAt: new Date()
      }
    });

    await this.applyDomainSideEffects(eventName, decodedArgs, log, timestamp);
    await this.publishEvent(eventName, decodedArgs, log, timestamp);
  }

  private async applyDomainSideEffects(
    eventName: string,
    args: Record<string, unknown>,
    log: Log | EventLog,
    timestamp: Date
  ): Promise<void> {
    switch (eventName) {
      case 'AccountCreated':
        await this.handleAccountCreated(args, timestamp);
        break;
      case 'OrderCreated':
      case 'OrderExecuted':
      case 'OrderCancelled':
        logger.info(`Indexed ${eventName} event`, {
          transactionHash: (log as Partial<EventLog>).transactionHash,
          orderId: args.orderId
        });
        break;
      default:
        break;
    }
  }

  private async handleAccountCreated(args: Record<string, unknown>, timestamp: Date): Promise<void> {
    const account = typeof args.account === 'string' ? args.account.toLowerCase() : null;
    const owner = typeof args.owner === 'string' ? args.owner.toLowerCase() : null;
    const salt = typeof args.salt === 'string' ? args.salt : null;

    if (!account || !owner) {
      logger.warn('AccountCreated event missing account or owner field', { args });
      return;
    }

    try {
      const user = await this.prisma.user.findFirst({
        where: { walletAddress: owner }
      });

      if (!user) {
        logger.info('AccountCreated event for unknown owner', { owner });
        return;
      }

      await this.prisma.smartAccount.upsert({
        where: { address: account },
        update: {
          isActive: true,
          saltNonce: salt ?? '0x0',
          lastUsedAt: timestamp
        },
        create: {
          address: account,
          userId: user.id,
          saltNonce: salt ?? '0x0',
          deployedAt: timestamp,
          lastUsedAt: timestamp,
          isActive: true
        }
      });

      await this.prisma.user.update({
        where: { id: user.id },
        data: { smartAccountAddress: account }
      }).catch(error => {
        logger.warn('Failed to update user smart account address', {
          owner,
          error: error instanceof Error ? error.message : 'unknown'
        });
      });

      logger.info(`Linked smart account ${account} to owner ${owner}`);
    } catch (error) {
      logger.error('Failed to process AccountCreated event', error);
    }
  }

  private async publishEvent(
    eventName: string,
    args: Record<string, unknown>,
    log: Log | EventLog,
    timestamp: Date
  ): Promise<void> {
    try {
      const payload: StreamBlockchainEvent = {
        contractAddress: log.address,
        eventName,
        blockNumber: log.blockNumber,
        transactionHash: (log as Partial<EventLog>).transactionHash ?? '',
        args,
        timestamp: timestamp.toISOString()
      };

      await this.redisService.addBlockchainEvent(payload);
      this.webSocketService?.broadcastBlockchainEvent(payload);
    } catch (error) {
      logger.error('Failed to publish blockchain event to downstream services', error);
    }
  }

  private async updateLastIndexedBlock(contractId: string, blockNumber: number): Promise<void> {
    try {
      await this.prisma.indexedContract.update({
        where: { id: contractId },
        data: { lastIndexedBlock: blockNumber }
      });
    } catch (error) {
      logger.warn('Failed to update indexed contract progress', {
        contractId,
        blockNumber,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }

  private async getBlockTimestamp(blockNumber: number): Promise<Date> {
    const cached = this.blockTimestampCache.get(blockNumber);
    if (cached) {
      return cached;
    }

    try {
      const block = await this.provider.getBlock(blockNumber);
      const timestamp = block?.timestamp
        ? new Date(Number(block.timestamp) * 1000)
        : new Date();

      this.blockTimestampCache.set(blockNumber, timestamp);

      if (this.blockTimestampCache.size > BLOCK_CACHE_SIZE) {
        const oldestKey = Array.from(this.blockTimestampCache.keys()).sort((a, b) => a - b)[0];
        this.blockTimestampCache.delete(oldestKey);
      }

      return timestamp;
    } catch (error) {
      logger.warn('Failed to fetch block timestamp', {
        blockNumber,
        error: error instanceof Error ? error.message : 'unknown'
      });
      return new Date();
    }
  }

  private normalizeArgs(result: Result): Record<string, unknown> {
    const output: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(result)) {
      if (!Number.isNaN(Number(key))) {
        continue;
      }

      output[key] = this.serializeValue(value);
    }

    return output;
  }

  private serializeValue(value: unknown): unknown {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.map(item => this.serializeValue(item));
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([key]) => Number.isNaN(Number(key))
      );

      if (entries.length === 0) {
        const stringified = value.toString();
        return stringified === '[object Object]' ? null : stringified;
      }

      const serialized: Record<string, unknown> = {};
      for (const [key, innerValue] of entries) {
        serialized[key] = this.serializeValue(innerValue);
      }
      return serialized;
    }

    return value;
  }
}

export default EventIndexingService;
