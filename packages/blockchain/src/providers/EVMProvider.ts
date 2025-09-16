import { JsonRpcProvider, WebSocketProvider, Contract, Wallet, ContractFactory } from 'ethers';
import type { 
  IBlockchainProvider,
  NetworkConfig,
  SeiTransaction,
  GasEstimate
} from '../types';
import { BlockchainError, TransactionError } from '../types';
import { TransactionMonitor, GasEstimator } from '../utils/TransactionUtils';
import { AdvancedGasEstimator } from '../utils/GasEstimator';

export class EVMProvider implements IBlockchainProvider {
  private provider: JsonRpcProvider;
  private wsProvider?: WebSocketProvider;
  private wallet?: Wallet;
  private gasEstimator: GasEstimator;
  private advancedGasEstimator: AdvancedGasEstimator;
  private transactionMonitor: TransactionMonitor;

  constructor(
    private config: NetworkConfig,
    privateKey?: string
  ) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    
    if (config.wsUrl) {
      this.wsProvider = new WebSocketProvider(config.wsUrl);
    }

    if (privateKey) {
      this.wallet = new Wallet(privateKey, this.provider);
    }

    this.gasEstimator = new GasEstimator(this.provider);
    this.advancedGasEstimator = new AdvancedGasEstimator(this.provider, config);
    this.transactionMonitor = new TransactionMonitor(this.provider);

    // Start gas price tracking
    this.advancedGasEstimator.startTracking();
  }

  async getBalance(address: string): Promise<string> {
    try {
      const balance = await this.provider.getBalance(address);
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
      const tx = await this.provider.getTransaction(hash);
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
        status: tx.blockNumber ? 'confirmed' : 'pending'
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
      if (!this.wallet) {
        throw new BlockchainError('Wallet not configured', 'AUTH_ERROR');
      }

      // Enhance transaction with optimal gas settings
      const enhancedTx = await this.enhanceTransaction(tx);
      
      const response = await this.wallet.sendTransaction(enhancedTx);
      return response;
    } catch (error: unknown) {
      throw new TransactionError('Failed to send transaction', undefined, error);
    }
  }

  async waitForTransaction(hash: string): Promise<any> {
    try {
      return await this.transactionMonitor.waitForTransaction(hash, 1, 60000);
    } catch (error: unknown) {
      throw new TransactionError(
        `Failed to wait for transaction ${hash}`,
        hash,
        error
      );
    }
  }

  async estimateGas(tx: any): Promise<string> {
    try {
      const estimate = await this.gasEstimator.estimateGas(tx);
      return estimate.gasLimit;
    } catch (error: unknown) {
      throw new BlockchainError('Failed to estimate gas', 'GAS_ERROR', error);
    }
  }

  async getGasPrice(): Promise<string> {
    try {
      const feeData = await this.provider.getFeeData();
      return feeData.gasPrice?.toString() || '0';
    } catch (error: unknown) {
      throw new BlockchainError('Failed to get gas price', 'GAS_PRICE_ERROR', error);
    }
  }

  async getBlockNumber(): Promise<number> {
    try {
      return await this.provider.getBlockNumber();
    } catch (error: unknown) {
      throw new BlockchainError('Failed to get block number', 'BLOCK_ERROR', error);
    }
  }

  async getBlock(blockNumber: number): Promise<any> {
    try {
      return await this.provider.getBlock(blockNumber);
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
      return await this.provider.getLogs(filter);
    } catch (error: unknown) {
      throw new BlockchainError('Failed to get logs', 'LOGS_ERROR', error);
    }
  }

  async call(tx: any): Promise<string> {
    try {
      return await this.provider.call(tx);
    } catch (error: unknown) {
      throw new BlockchainError('Failed to call contract', 'CALL_ERROR', error);
    }
  }

  // Enhanced methods
  async getAdvancedGasEstimate(tx: any): Promise<{
    conservative: GasEstimate;
    standard: GasEstimate;
    fast: GasEstimate;
    recommended: GasEstimate;
  }> {
    return await this.advancedGasEstimator.getComprehensiveEstimate(tx);
  }

  async getOptimalGasPrice(): Promise<{
    gasPrice: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }> {
    return await this.gasEstimator.getOptimalGasPrice();
  }

  getGasPriceTrend(): 'increasing' | 'decreasing' | 'stable' | 'insufficient_data' {
    return this.advancedGasEstimator.getGasPriceTrend();
  }

  async getTransactionStatus(hash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations: number;
    blockNumber?: number;
    gasUsed?: string;
  }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(hash);
      
      if (!receipt) {
        return { status: 'pending', confirmations: 0 };
      }

      const currentBlock = await this.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;

      return {
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        confirmations,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error: unknown) {
      throw new TransactionError('Failed to get transaction status', hash, error);
    }
  }

  // Contract interaction helpers
  async deployContract(
    bytecode: string,
    abi: any[],
    constructorArgs: any[] = [],
    gasLimit?: string
  ): Promise<{
    contract: Contract;
    deploymentHash: string;
    address: string;
  }> {
    if (!this.wallet) {
      throw new BlockchainError('Wallet not configured for deployment', 'AUTH_ERROR');
    }

    try {
      const factory = new ContractFactory(abi, bytecode, this.wallet);
      
      // Get gas estimates for deployment
      const tempDeployTx = await factory.getDeployTransaction(...constructorArgs);
      const gasEstimate = await this.getAdvancedGasEstimate(tempDeployTx);

      const contract = await factory.deploy(...constructorArgs, {
        gasLimit: gasLimit || gasEstimate.recommended.gasLimit,
        maxFeePerGas: gasEstimate.recommended.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.recommended.maxPriorityFeePerGas
      });

      await contract.waitForDeployment();

      return {
        contract: contract as Contract,
        deploymentHash: contract.deploymentTransaction()?.hash || '',
        address: await contract.getAddress()
      };
    } catch (error: unknown) {
      throw new BlockchainError('Contract deployment failed', 'DEPLOYMENT_ERROR', error);
    }
  }

  // Transaction monitoring
  async *watchTransactions(addresses: string[]): AsyncGenerator<SeiTransaction> {
    if (!this.wsProvider) {
      throw new BlockchainError('WebSocket provider not available', 'WS_ERROR');
    }

    const transactionQueue: SeiTransaction[] = [];
    let resolveNext: (() => void) | null = null;

    this.wsProvider.on('pending', async (txHash: string) => {
      try {
        const tx = await this.getTransaction(txHash);
        if (tx && (addresses.includes(tx.from) || addresses.includes(tx.to))) {
          transactionQueue.push(tx);
          if (resolveNext) {
            resolveNext();
            resolveNext = null;
          }
        }
      } catch (error: unknown) {
        console.warn('Error watching transaction:', error);
      }
    });

    while (true) {
      if (transactionQueue.length > 0) {
        yield transactionQueue.shift()!;
      } else {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    }
  }

  // Event monitoring
  async subscribeToContractEvents(
    contractAddress: string,
    abi: any[],
    eventName?: string,
    callback?: (event: any) => void
  ): Promise<void> {
    if (!this.wsProvider) {
      throw new BlockchainError('WebSocket provider not available', 'WS_ERROR');
    }

    const contract = new Contract(contractAddress, abi, this.wsProvider);
    
    if (eventName) {
      contract.on(eventName, callback || ((event) => {
        console.log(`Event ${eventName}:`, event);
      }));
    } else {
      contract.on('*', callback || ((event) => {
        console.log('Contract event:', event);
      }));
    }
  }

  // Private helper methods
  private async enhanceTransaction(tx: any): Promise<any> {
    const enhanced = { ...tx };

    // Add gas estimation if not provided
    if (!enhanced.gasLimit) {
      const gasEstimate = await this.getAdvancedGasEstimate(enhanced);
      enhanced.gasLimit = gasEstimate.recommended.gasLimit;
      enhanced.maxFeePerGas = gasEstimate.recommended.maxFeePerGas;
      enhanced.maxPriorityFeePerGas = gasEstimate.recommended.maxPriorityFeePerGas;
    }

    // Add nonce if not provided
    if (!enhanced.nonce && this.wallet) {
      enhanced.nonce = await this.wallet.getNonce();
    }

    return enhanced;
  }

  // Network info
  getNetworkConfig(): NetworkConfig {
    return this.config;
  }

  getProvider(): JsonRpcProvider {
    return this.provider;
  }

  getWebSocketProvider(): WebSocketProvider | undefined {
    return this.wsProvider;
  }

  getWallet(): Wallet | undefined {
    return this.wallet;
  }

  // Cleanup
  async destroy(): Promise<void> {
    if (this.wsProvider) {
      await this.wsProvider.destroy();
    }
    this.provider.destroy();
  }
}