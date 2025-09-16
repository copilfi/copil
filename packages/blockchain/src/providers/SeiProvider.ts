import { JsonRpcProvider, WebSocketProvider, Wallet } from 'ethers';
import { createPublicClient, createWalletClient, http, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Define Sei chain configuration
const seiMainnet = {
  id: 1329,
  name: 'Sei Network',
  network: 'sei',
  nativeCurrency: {
    decimals: 18,
    name: 'Sei',
    symbol: 'SEI',
  },
  rpcUrls: {
    public: { http: ['https://evm-rpc.sei-apis.com'] },
    default: { http: ['https://evm-rpc.sei-apis.com'] },
  },
  blockExplorers: {
    default: { name: 'SeiScan', url: 'https://seitrace.com' },
  },
} as const;
import { 
  IBlockchainProvider, 
  NetworkConfig, 
  SeiTransaction, 
  BlockchainError,
  SeiCosmosTransaction,
  SeiAccountInfo 
} from '../types';
import { SEI_BLOCK_TIME } from '../constants/networks';
import axios from 'axios';

export class SeiProvider implements IBlockchainProvider {
  private evmProvider: JsonRpcProvider;
  private wsProvider?: WebSocketProvider;
  private cosmosRpcUrl: string;
  private cosmosLcdUrl: string;
  private viemPublicClient?: PublicClient;
  private viemWalletClient?: WalletClient;

  constructor(
    private config: NetworkConfig,
    private privateKey?: string
  ) {
    this.evmProvider = new JsonRpcProvider(config.rpcUrl);
    
    if (config.wsUrl) {
      this.wsProvider = new WebSocketProvider(config.wsUrl);
    }

    // Set Cosmos endpoints based on network
    if (config.chainId === 713715) { // Testnet
      this.cosmosRpcUrl = 'https://rpc-testnet.sei-apis.com';
      this.cosmosLcdUrl = 'https://lcd-testnet.sei-apis.com';
    } else { // Mainnet
      this.cosmosRpcUrl = 'https://rpc.sei-apis.com';
      this.cosmosLcdUrl = 'https://lcd.sei-apis.com';
    }

    // Initialize Viem clients
    this.initializeViemClients();
  }

  // EVM Provider methods
  async getBalance(address: string): Promise<string> {
    try {
      const balance = await this.evmProvider.getBalance(address);
      return balance.toString();
    } catch (error: unknown) {
      throw new BlockchainError(
        `Failed to get balance for ${address}`,
        'BALANCE_ERROR',
        error
      );
    }
  }

  async getTransaction(hash: string): Promise<SeiTransaction | null> {
    try {
      const tx = await this.evmProvider.getTransaction(hash);
      if (!tx) return null;

      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: tx.value.toString(),
        gasLimit: tx.gasLimit.toString(),
        gasPrice: tx.gasPrice?.toString() || '0',
        nonce: tx.nonce,
        data: tx.data,
        blockNumber: tx.blockNumber || undefined,
        blockHash: tx.blockHash || undefined,
      };
    } catch (error: unknown) {
      throw new BlockchainError(
        `Failed to get transaction ${hash}`,
        'TRANSACTION_ERROR',
        error
      );
    }
  }

  async sendTransaction(tx: any): Promise<any> {
    try {
      if (!this.privateKey) {
        throw new BlockchainError('Private key required for sending transactions', 'AUTH_ERROR');
      }

      const wallet = new Wallet(this.privateKey, this.evmProvider);
      const response = await wallet.sendTransaction(tx);
      return response;
    } catch (error: unknown) {
      throw new BlockchainError('Failed to send transaction', 'SEND_ERROR', error);
    }
  }

  async waitForTransaction(hash: string): Promise<any> {
    try {
      const receipt = await this.evmProvider.waitForTransaction(hash);
      return receipt;
    } catch (error: unknown) {
      throw new BlockchainError(
        `Failed to wait for transaction ${hash}`,
        'WAIT_ERROR',
        error
      );
    }
  }

  async estimateGas(tx: any): Promise<string> {
    try {
      const gasEstimate = await this.evmProvider.estimateGas(tx);
      return gasEstimate.toString();
    } catch (error: unknown) {
      throw new BlockchainError('Failed to estimate gas', 'GAS_ERROR', error);
    }
  }

  async getGasPrice(): Promise<string> {
    try {
      const feeData = await this.evmProvider.getFeeData();
      return feeData.gasPrice?.toString() || '0';
    } catch (error: unknown) {
      throw new BlockchainError('Failed to get gas price', 'GAS_PRICE_ERROR', error);
    }
  }

  async getBlockNumber(): Promise<number> {
    try {
      return await this.evmProvider.getBlockNumber();
    } catch (error: unknown) {
      throw new BlockchainError('Failed to get block number', 'BLOCK_ERROR', error);
    }
  }

  async getBlock(blockNumber: number): Promise<any> {
    try {
      return await this.evmProvider.getBlock(blockNumber);
    } catch (error: unknown) {
      throw new BlockchainError(
        `Failed to get block ${blockNumber}`,
        'BLOCK_ERROR',
        error
      );
    }
  }

  async getLogs(filter: any): Promise<any[]> {
    try {
      return await this.evmProvider.getLogs(filter);
    } catch (error: unknown) {
      throw new BlockchainError('Failed to get logs', 'LOGS_ERROR', error);
    }
  }

  async call(tx: any): Promise<string> {
    try {
      return await this.evmProvider.call(tx);
    } catch (error: unknown) {
      throw new BlockchainError('Failed to call contract', 'CALL_ERROR', error);
    }
  }

  // Sei-specific Cosmos methods
  async getCosmosAccount(address: string): Promise<SeiAccountInfo | null> {
    try {
      const response = await axios.get(
        `${this.cosmosLcdUrl}/cosmos/auth/v1beta1/accounts/${address}`
      );
      return response.data.account;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new BlockchainError(
        `Failed to get Cosmos account ${address}`,
        'COSMOS_ACCOUNT_ERROR',
        error
      );
    }
  }

  async getCosmosTransaction(hash: string): Promise<SeiCosmosTransaction | null> {
    try {
      const response = await axios.get(
        `${this.cosmosLcdUrl}/cosmos/tx/v1beta1/txs/${hash}`
      );
      return response.data.tx_response;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new BlockchainError(
        `Failed to get Cosmos transaction ${hash}`,
        'COSMOS_TX_ERROR',
        error
      );
    }
  }

  private initializeViemClients(): void {
    // Public client for read operations
    this.viemPublicClient = createPublicClient({
      chain: seiMainnet,
      transport: http(this.config.rpcUrl)
    });

    // Wallet client for transactions (only if private key provided)
    if (this.privateKey) {
      const account = privateKeyToAccount(this.privateKey as `0x${string}`);
      this.viemWalletClient = createWalletClient({
        account,
        chain: seiMainnet,
        transport: http(this.config.rpcUrl)
      });
    }
  }

  // Viem client getters
  getViemPublicClient(): PublicClient | undefined {
    return this.viemPublicClient;
  }

  getViemWalletClient(): WalletClient | undefined {
    return this.viemWalletClient;
  }

  getAddress(): string {
    if (this.viemWalletClient?.account) {
      return this.viemWalletClient.account.address;
    }
    if (this.privateKey) {
      const account = privateKeyToAccount(this.privateKey as `0x${string}`);
      return account.address;
    }
    throw new BlockchainError('No account available', 'NO_ACCOUNT');
  }

  // WebSocket subscription methods
  onNewBlocks(callback: (block: any) => void): void {
    if (!this.wsProvider) {
      throw new BlockchainError('WebSocket provider not available', 'WS_ERROR');
    }

    this.wsProvider.on('block', callback);
  }

  onNewTransactions(callback: (tx: any) => void): void {
    if (!this.wsProvider) {
      throw new BlockchainError('WebSocket provider not available', 'WS_ERROR');
    }

    this.wsProvider.on('pending', callback);
  }

  // Sei-specific utility methods
  async waitForBlocks(count: number): Promise<void> {
    const startBlock = await this.getBlockNumber();
    const targetBlock = startBlock + count;
    
    while (true) {
      const currentBlock = await this.getBlockNumber();
      if (currentBlock >= targetBlock) {
        break;
      }
      
      // Wait for approximately one Sei block time
      await new Promise(resolve => setTimeout(resolve, SEI_BLOCK_TIME));
    }
  }

  async getFastFinality(): Promise<boolean> {
    // Sei provides fast finality (~390ms)
    // This method can be used to check if transactions are final
    try {
      const latestBlock = await this.getBlockNumber();
      const block = await this.getBlock(latestBlock);
      
      // In Sei, blocks are final when they appear
      // This is different from other chains that require confirmations
      return block !== null;
    } catch (error: unknown) {
      throw new BlockchainError('Failed to check finality', 'FINALITY_ERROR', error);
    }
  }

  // Network information
  getNetworkConfig(): NetworkConfig {
    return this.config;
  }

  getEvmProvider(): JsonRpcProvider {
    return this.evmProvider;
  }

  getWebSocketProvider(): WebSocketProvider | undefined {
    return this.wsProvider;
  }

  getCosmosRpcUrl(): string {
    return this.cosmosRpcUrl;
  }

  getCosmosLcdUrl(): string {
    return this.cosmosLcdUrl;
  }

  // Cleanup
  async destroy(): Promise<void> {
    if (this.wsProvider) {
      await this.wsProvider.destroy();
    }
    this.evmProvider.destroy();
  }
}