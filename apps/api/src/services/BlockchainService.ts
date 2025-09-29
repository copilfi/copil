import { 
  SeiProvider, 
  SmartAccountClient, 
  ConditionalOrderEngineContract,
  AccountFactoryContract 
} from '@copil/blockchain';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import redis from '@/config/redis';

class BlockchainService {
  private seiProvider: SeiProvider;
  private smartAccountClients: Map<string, SmartAccountClient> = new Map();
  private orderEngine?: ConditionalOrderEngineContract;
  private accountFactory?: AccountFactoryContract;

  constructor() {
    this.seiProvider = new SeiProvider({
      chainId: env.NODE_ENV === 'production' ? 1329 : 713715,
      name: env.NODE_ENV === 'production' ? 'Sei Mainnet' : 'Sei Testnet',
      rpcUrl: env.NODE_ENV === 'production' ? env.SEI_MAINNET_RPC_URL : env.SEI_TESTNET_RPC_URL,
      blockExplorer: 'https://seitrace.com',
      nativeCurrency: {
        symbol: 'SEI',
        name: 'Sei',
        decimals: 18
      },
      contracts: {
        entryPoint: env.ENTRY_POINT_ADDRESS || '',
        accountFactory: env.ACCOUNT_FACTORY_ADDRESS,
        conditionalOrderEngine: env.CONDITIONAL_ORDER_ENGINE_ADDRESS
      }
    });

    this.initializeContracts();
  }

  private async initializeContracts(): Promise<void> {
    try {
      if (env.CONDITIONAL_ORDER_ENGINE_ADDRESS && this.seiProvider) {
        this.orderEngine = new ConditionalOrderEngineContract(
          this.seiProvider,
          env.CONDITIONAL_ORDER_ENGINE_ADDRESS
        );
      }

      if (env.ACCOUNT_FACTORY_ADDRESS && this.seiProvider) {
        this.accountFactory = new AccountFactoryContract(
          this.seiProvider,
          env.ACCOUNT_FACTORY_ADDRESS
        );
      }

      logger.info('🔗 Blockchain contracts initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize blockchain contracts:', error);
    }
  }

  /**
   * Get or create Smart Account client for user
   */
  async getSmartAccountClient(
    userAddress: string,
    privateKey?: string
  ): Promise<SmartAccountClient> {
    const cacheKey = `smart_account_${userAddress}`;
    
    if (this.smartAccountClients.has(cacheKey)) {
      return this.smartAccountClients.get(cacheKey)!;
    }

    if (!env.ENTRY_POINT_ADDRESS || !env.ACCOUNT_FACTORY_ADDRESS) {
      throw new Error('Smart account contracts not deployed yet');
    }

    if (!this.seiProvider) {
      throw new Error('SEI provider not initialized');
    }

    const client = new SmartAccountClient(
      this.seiProvider,
      {
        entryPoint: env.ENTRY_POINT_ADDRESS,
        factory: env.ACCOUNT_FACTORY_ADDRESS,
        owner: userAddress,
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
      },
      privateKey
    );

    this.smartAccountClients.set(cacheKey, client);
    return client;
  }

  /**
   * Deploy Smart Account for user
   */
  async deploySmartAccount(userAddress: string, privateKey?: string): Promise<string> {
    try {
      const client = await this.getSmartAccountClient(userAddress, privateKey);
      const accountAddress = await client.deployAccount();
      
      // Cache the deployed address
      await redis.setJSON(`deployed_account_${userAddress}`, {
        address: accountAddress,
        deployedAt: new Date().toISOString()
      }, 3600); // Cache for 1 hour
      
      logger.info(`✅ Smart Account deployed for ${userAddress}: ${accountAddress}`);
      return accountAddress;
    } catch (error) {
      logger.error(`❌ Failed to deploy Smart Account for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get Smart Account address (deployed or predicted)
   */
  async getSmartAccountAddress(userAddress: string): Promise<string> {
    try {
      // Check cache first
      const cached = await redis.getJSON<{ address: string; deployedAt: string }>(
        `deployed_account_${userAddress}`
      );
      
      if (cached) {
        return cached.address;
      }

      const client = await this.getSmartAccountClient(userAddress);
      return await client.getAccountAddress();
    } catch (error) {
      logger.error(`❌ Failed to get Smart Account address for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Execute transaction through Smart Account
   */
  async executeTransaction(
    userAddress: string,
    to: string,
    value: string,
    data: string,
    privateKey?: string
  ): Promise<string> {
    try {
      const client = await this.getSmartAccountClient(userAddress, privateKey);
      const txHash = await client.executeTransaction(to, value, data);
      
      logger.info(`✅ Transaction executed for ${userAddress}: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error(`❌ Failed to execute transaction for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Execute batch transactions
   */
  async executeBatchTransactions(
    userAddress: string,
    transactions: Array<{ to: string; value: string; data: string }>,
    privateKey?: string
  ): Promise<string> {
    try {
      const client = await this.getSmartAccountClient(userAddress, privateKey);
      
      const destinations = transactions.map(tx => tx.to);
      const values = transactions.map(tx => tx.value);
      const datas = transactions.map(tx => tx.data);
      
      const txHash = await client.executeBatch(destinations, values, datas);
      
      logger.info(`✅ Batch transaction executed for ${userAddress}: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error(`❌ Failed to execute batch transaction for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Create session key for automated trading
   */
  async createSessionKey(
    userAddress: string,
    sessionKeyConfig: {
      sessionKey: string;
      validUntil: number;
      limitAmount: string;
      allowedTargets: string[];
      allowedFunctions: string[];
    },
    privateKey?: string
  ): Promise<string> {
    try {
      const client = await this.getSmartAccountClient(userAddress, privateKey);
      const txHash = await client.createSessionKey(sessionKeyConfig);
      
      logger.info(`✅ Session key created for ${userAddress}: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error(`❌ Failed to create session key for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Revoke session key
   */
  async revokeSessionKey(
    userAddress: string,
    sessionKey: string,
    privateKey?: string
  ): Promise<string> {
    try {
      const client = await this.getSmartAccountClient(userAddress, privateKey);
      const txHash = await client.revokeSessionKey(sessionKey);
      
      logger.info(`✅ Session key revoked for ${userAddress}: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error(`❌ Failed to revoke session key for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get network information
   */
  async getNetworkInfo() {
    try {
      const blockNumber = await this.seiProvider.getBlockNumber();
      const gasPrice = await this.seiProvider.getGasPrice();

      return {
        chainId: env.NODE_ENV === 'production' ? 1329 : 713715,
        name: env.NODE_ENV === 'production' ? 'Sei Mainnet' : 'Sei Testnet',
        blockNumber,
        gasPrice: gasPrice.toString(),
        isTestnet: env.NODE_ENV !== 'production'
      };
    } catch (error) {
      logger.error('❌ Failed to get network info:', error);
      throw error;
    }
  }

  /**
   * Get balance for address
   */
  async getBalance(address: string): Promise<string> {
    try {
      return await this.seiProvider.getBalance(address);
    } catch (error) {
      logger.error(`❌ Failed to get balance for ${address}:`, error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.seiProvider.getBlockNumber();
      return true;
    } catch (error) {
      logger.error('❌ Blockchain service health check failed:', error);
      return false;
    }
  }
}

export const blockchainService = new BlockchainService();
export default blockchainService;
