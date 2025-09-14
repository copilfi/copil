import { SeiProvider } from '../providers/SeiProvider';
import { SmartAccountClient } from './SmartAccountClient';
import type { 
  NetworkConfig,
  SmartAccountConfig,
  SessionKeyConfig,
  UserOperation,
  BlockchainEvent,
  SeiTransaction
} from '../types';
import { DEFAULT_NETWORK } from '../constants/networks';
import { EventEmitter } from 'events';

export interface SeiClientConfig {
  network?: NetworkConfig;
  privateKey?: string;
  smartAccount?: SmartAccountConfig;
}

export class SeiClient extends EventEmitter {
  private provider: SeiProvider;
  private smartAccountClient?: SmartAccountClient;
  
  constructor(config: SeiClientConfig = {}) {
    super();
    
    const network = config.network || DEFAULT_NETWORK;
    this.provider = new SeiProvider(network, config.privateKey);
    
    if (config.smartAccount) {
      this.smartAccountClient = new SmartAccountClient(
        this.provider,
        config.smartAccount,
        config.privateKey
      );
    }
  }

  // Provider methods
  getProvider(): SeiProvider {
    return this.provider;
  }

  async getBalance(address: string): Promise<string> {
    return await this.provider.getBalance(address);
  }

  async getTransaction(hash: string): Promise<SeiTransaction | null> {
    return await this.provider.getTransaction(hash);
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getGasPrice(): Promise<string> {
    return await this.provider.getGasPrice();
  }

  // Smart Account methods
  getSmartAccount(): SmartAccountClient {
    if (!this.smartAccountClient) {
      throw new Error('Smart Account not configured');
    }
    return this.smartAccountClient;
  }

  async deploySmartAccount(): Promise<string> {
    if (!this.smartAccountClient) {
      throw new Error('Smart Account not configured');
    }
    return await this.smartAccountClient.deployAccount();
  }

  async createSessionKey(config: SessionKeyConfig): Promise<string> {
    if (!this.smartAccountClient) {
      throw new Error('Smart Account not configured');
    }
    return await this.smartAccountClient.createSessionKey(config);
  }

  async executeTransaction(to: string, value: string, data: string): Promise<string> {
    if (!this.smartAccountClient) {
      throw new Error('Smart Account not configured');
    }
    return await this.smartAccountClient.executeTransaction(to, value, data);
  }

  async executeBatch(
    destinations: string[],
    values: string[],
    datas: string[]
  ): Promise<string> {
    if (!this.smartAccountClient) {
      throw new Error('Smart Account not configured');
    }
    return await this.smartAccountClient.executeBatch(destinations, values, datas);
  }

  // ERC-4337 methods
  async buildUserOperation(
    to: string,
    value: string,
    data: string,
    options?: any
  ): Promise<UserOperation> {
    if (!this.smartAccountClient) {
      throw new Error('Smart Account not configured');
    }
    return await this.smartAccountClient.buildUserOperation(to, value, data, options);
  }

  async submitUserOperation(userOp: UserOperation): Promise<string> {
    if (!this.smartAccountClient) {
      throw new Error('Smart Account not configured');
    }
    const signedUserOp = await this.smartAccountClient.signUserOperation(userOp);
    return await this.smartAccountClient.submitUserOperation(signedUserOp);
  }

  // Event subscriptions
  subscribeToBlocks(callback: (block: any) => void): void {
    this.provider.onNewBlocks((block) => {
      const blockEvent: BlockchainEvent = {
        type: 'block',
        data: {
          number: block.number,
          hash: block.hash,
          timestamp: block.timestamp,
          transactions: block.transactions
        }
      };
      
      callback(block);
      this.emit('block', blockEvent);
    });
  }

  subscribeToTransactions(callback: (tx: any) => void): void {
    this.provider.onNewTransactions((tx) => {
      callback(tx);
      this.emit('transaction', { type: 'transaction', data: tx });
    });
  }

  // Utility methods
  async waitForTransaction(hash: string): Promise<any> {
    return await this.provider.waitForTransaction(hash);
  }

  async waitForBlocks(count: number): Promise<void> {
    return await this.provider.waitForBlocks(count);
  }

  async getFastFinality(): Promise<boolean> {
    return await this.provider.getFastFinality();
  }

  // Network info
  getNetworkConfig(): NetworkConfig {
    return this.provider.getNetworkConfig();
  }

  // Cleanup
  async destroy(): Promise<void> {
    this.removeAllListeners();
    await this.provider.destroy();
  }

  // Static factory methods
  static createForTestnet(privateKey?: string): SeiClient {
    return new SeiClient({
      network: DEFAULT_NETWORK,
      privateKey
    });
  }

  static createWithSmartAccount(
    owner: string,
    entryPoint: string,
    factory: string,
    privateKey?: string,
    salt?: string
  ): SeiClient {
    return new SeiClient({
      network: DEFAULT_NETWORK,
      privateKey,
      smartAccount: {
        owner,
        entryPoint,
        factory,
        salt: salt || '0x0000000000000000000000000000000000000000000000000000000000000000'
      }
    });
  }
}