import { ethers, Wallet, Contract } from 'ethers';
import { logger } from '@/utils/logger';
import redis from '@/config/redis';
import env from '@/config/env';
import SmartAccountService, { SmartAccountConfig, SessionKeyConfig } from '../../../../packages/blockchain/src/services/SmartAccountService';
import SessionKeyWallet from '../../../../packages/blockchain/src/services/SessionKeyWallet';
import TestWalletService, { TestWalletConfig } from '../../../../packages/blockchain/src/services/TestWalletService';
import UserOperationBundler, { BundlerConfig } from '../../../../packages/blockchain/src/services/UserOperationBundler';
import BalanceService, { TokenPriceProvider, WalletBalances } from '../../../../packages/blockchain/src/services/BalanceService';
import MarketDataService from './MarketDataService';

// Basic ABI for common contract interactions
const ACCOUNT_FACTORY_ABI = [
  'function createAccount(address owner, bytes32 salt) external returns (address)',
  'function getAccount(address owner) external view returns (address)',
  'function getAddress(address owner, bytes32 salt) external view returns (address)',
  'event AccountCreated(address indexed account, address indexed owner, bytes32 indexed salt)'
];

const SMART_ACCOUNT_ABI = [
  'function execute(address dest, uint256 value, bytes calldata func) external',
  'function executeBatch(address[] calldata dest, uint256[] calldata values, bytes[] calldata func) external',
  'function createSessionKey(address sessionKey, uint256 validUntil, uint256 limitAmount, address[] calldata allowedTargets, bytes4[] calldata allowedFunctions) external',
  'function revokeSessionKey(address sessionKey) external',
  'function owner() external view returns (address)',
  'function getNonce() external view returns (uint256)',
  'event SessionKeyCreated(address indexed sessionKey, uint256 validUntil)',
  'event SessionKeyRevoked(address indexed sessionKey)'
];

const ENTRY_POINT_ABI = [
  'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] calldata ops, address beneficiary) external',
  'function getNonce(address sender, uint192 key) external view returns (uint256 nonce)',
  'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) calldata userOp) external view returns (bytes32)'
];

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

class MarketDataPriceProvider implements TokenPriceProvider {
  constructor(private readonly marketDataService: MarketDataService) {}

  async getTokenPrice(address: string, symbol?: string): Promise<number | null> {
    const normalized = address.toLowerCase();
    if (normalized === ethers.ZeroAddress.toLowerCase()) {
      return this.getNativeTokenPrice();
    }

    const tokenSymbol = symbol?.toUpperCase();
    if (!tokenSymbol) {
      return null;
    }

    const metrics = await this.marketDataService.getTokenMetrics(tokenSymbol);
    return metrics?.price ?? null;
  }

  async getNativeTokenPrice(): Promise<number | null> {
    const metrics = await this.marketDataService.getTokenMetrics('SEI');
    return metrics?.price ?? null;
  }
}

interface SmartAccountClient {
  deployAccount(): Promise<string>;
  getAccountAddress(): Promise<string>;
  executeTransaction(to: string, value: string, data: string): Promise<string>;
  executeBatch(destinations: string[], values: string[], datas: string[]): Promise<string>;
  createSessionKey(sessionKeyConfig: any): Promise<string>;
  revokeSessionKey(sessionKey: string): Promise<string>;
  getAccountInfo(): Promise<{
    address: string;
    owner: string;
    nonce: string;
    balance: string;
    isDeployed: boolean;
  }>;
}

class RealBlockchainService {
  private provider: ethers.JsonRpcProvider;
  private smartAccountService: SmartAccountService;
  private sessionKeyWallet: SessionKeyWallet;
  private testWalletService: TestWalletService;
  private userOperationBundler: UserOperationBundler;
  private balanceService: BalanceService;
  private smartAccountClients: Map<string, SmartAccountClient> = new Map();
  private marketDataService?: MarketDataService;
  private tokenSymbolCache: Map<string, string> = new Map();

  constructor() {
    // Primary: Alchemy RPC, Fallback: SEI RPC
    const rpcUrl = env.NODE_ENV === 'production' 
      ? env.ALCHEMY_SEI_RPC_URL || env.SEI_MAINNET_RPC_URL 
      : env.SEI_TESTNET_RPC_URL;
      
    this.provider = new ethers.JsonRpcProvider(rpcUrl, {
      name: 'sei-network',
      chainId: env.NODE_ENV === 'production' ? env.SEI_CHAIN_ID : env.SEI_TESTNET_CHAIN_ID
    });
    
    // Initialize Smart Account service
    const smartAccountConfig: SmartAccountConfig = {
      factoryAddress: env.ACCOUNT_FACTORY_ADDRESS!,
      entryPointAddress: env.ENTRY_POINT_ADDRESS!,
      rpcUrl,
      chainId: env.NODE_ENV === 'production' ? env.SEI_CHAIN_ID : env.SEI_TESTNET_CHAIN_ID
    };
    this.smartAccountService = new SmartAccountService(smartAccountConfig);
    
    // Initialize Session Key wallet
    this.sessionKeyWallet = new SessionKeyWallet(this.provider);

    // Initialize balance service for token queries
    this.balanceService = new BalanceService(this.provider);
    
    // Initialize Test wallet service
    const automationPrivateKey = env.AUTOMATION_PRIVATE_KEY || env.PRIVATE_KEY;
    const testWalletConfig: TestWalletConfig = {
      privateKey: automationPrivateKey,
      rpcUrl,
      chainId: env.NODE_ENV === 'production' ? env.SEI_CHAIN_ID : env.SEI_TESTNET_CHAIN_ID,
      autoFund: env.NODE_ENV !== 'production',
      fundingAmount: '10.0'
    };
    this.testWalletService = new TestWalletService(testWalletConfig);
    
    // Initialize User Operation bundler
    const bundlerConfig: BundlerConfig = {
      entryPointAddress: env.ENTRY_POINT_ADDRESS!,
      bundlerPrivateKey: automationPrivateKey!,
      rpcUrl,
      chainId: env.NODE_ENV === 'production' ? env.SEI_CHAIN_ID : env.SEI_TESTNET_CHAIN_ID,
      maxBundleSize: 10,
      bundleInterval: 5000 // 5 seconds
    };
    this.userOperationBundler = new UserOperationBundler(bundlerConfig);
    
    // Start bundler in non-production environments
    if (env.NODE_ENV !== 'production') {
      this.userOperationBundler.start().catch(error => {
        logger.error('Failed to start UserOperation bundler:', error);
      });
    }
    
    logger.info(`🔗 Real Blockchain Service initialized with ${env.NODE_ENV} network`);
    logger.info(`🌐 Primary RPC: ${env.ALCHEMY_SEI_RPC_URL ? 'Alchemy' : 'SEI Native'}`);
    logger.info(`🌐 Using RPC URL: ${rpcUrl}`);
    logger.info(`🏭 Account Factory: ${env.ACCOUNT_FACTORY_ADDRESS || 'Not configured'}`);
    logger.info(`🔑 Entry Point: ${env.ENTRY_POINT_ADDRESS || 'Not configured'}`);
    logger.info(`🤖 Automation Key: ${automationPrivateKey ? 'Configured' : 'Not configured'}`);
    
    if (env.ALCHEMY_SEI_WS_URL) {
      logger.info(`🔌 WebSocket: ${env.ALCHEMY_SEI_WS_URL}`);
    }
  }

  registerMarketDataService(service: MarketDataService): void {
    this.marketDataService = service;
    this.setPriceProvider(new MarketDataPriceProvider(service));
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  setPriceProvider(provider: TokenPriceProvider): void {
    this.balanceService.setPriceProvider(provider);
  }

  registerTokenMetadata(address: string, symbol?: string): void {
    if (!address) {
      return;
    }

    const normalized = address.toLowerCase();
    if (symbol) {
      this.tokenSymbolCache.set(normalized, symbol.toUpperCase());
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

    const client = new SmartAccountClientImpl(
      this.provider,
      userAddress,
      privateKey
    );

    this.smartAccountClients.set(cacheKey, client);
    return client;
  }

  /**
   * Prepare Smart Account deployment transaction data for MetaMask
   */
  async prepareSmartAccountDeployment(userAddress: string): Promise<any> {
    try {
      if (!env.ACCOUNT_FACTORY_ADDRESS) {
        throw new Error('Account Factory not deployed yet. Run deployment first.');
      }

      // Generate deterministic salt based on user address
      const deploymentSalt = ethers.keccak256(ethers.toUtf8Bytes(userAddress));
      
      // Create factory contract interface
      const factory = new Contract(
        env.ACCOUNT_FACTORY_ADDRESS,
        ACCOUNT_FACTORY_ABI,
        this.provider
      );
      
      // Get predicted Smart Account address using manual call to avoid ethers.js method conflict
      const getAddressSelector = ethers.id('getAddress(address,bytes32)').slice(0, 10);
      const callData = ethers.concat([
        getAddressSelector,
        ethers.zeroPadValue(userAddress, 32),
        deploymentSalt
      ]);
      
      const result = await this.provider.call({
        to: env.ACCOUNT_FACTORY_ADDRESS,
        data: callData
      });
      
      const predictedAddress = ethers.getAddress('0x' + result.slice(-40));
      
      logger.info(`🔍 Smart Account prediction for ${userAddress}:`);
      logger.info(`   Salt: ${deploymentSalt}`);
      logger.info(`   Predicted Address: ${predictedAddress}`);
      logger.info(`   Factory Address: ${env.ACCOUNT_FACTORY_ADDRESS}`);
      
      // Check if already deployed
      const code = await this.provider.getCode(predictedAddress);
      const isDeployed = code !== '0x';
      
      logger.info(`   Contract Code: ${code}`);
      logger.info(`   Is Deployed: ${isDeployed}`);
      
      if (isDeployed) {
        return {
          transactionData: null,
          isAlreadyDeployed: true,
          address: predictedAddress
        };
      }

      
      // Estimate gas
      const gasEstimate = await factory.createAccount.estimateGas(userAddress, deploymentSalt);
      const feeData = await this.provider.getFeeData();
      
      // Prepare transaction data
      const transactionData = {
        to: env.ACCOUNT_FACTORY_ADDRESS,
        data: factory.interface.encodeFunctionData('createAccount', [userAddress, deploymentSalt]),
        gasLimit: (gasEstimate * BigInt(120) / BigInt(100)).toString(), // 20% buffer
        maxFeePerGas: feeData.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
        value: '0'
      };
      
      logger.info(`🔨 Smart Account deployment transaction prepared for ${userAddress}`);
      logger.info(`📊 Transaction data:`, JSON.stringify(transactionData, null, 2));
      return {
        transactionData,
        isAlreadyDeployed: false,
        estimatedAddress: predictedAddress
      };
    } catch (error) {
      logger.error(`❌ Failed to prepare Smart Account deployment for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Deploy Smart Account for user
   */
  async deploySmartAccount(userAddress: string, privateKey?: string): Promise<string> {
    try {
      if (!env.ACCOUNT_FACTORY_ADDRESS) {
        throw new Error('Account Factory not deployed yet. Run deployment first.');
      }

      const signerWallet = privateKey ? new Wallet(privateKey, this.provider) : this.testWalletService.getPrimaryWallet();
      const result = await this.smartAccountService.createSmartAccount(userAddress, signerWallet);
      
      // Cache the deployed address
      await redis.setJSON(`deployed_account_${userAddress}`, {
        address: result.address,
        deployedAt: new Date().toISOString(),
        isDeployed: result.isDeployed
      }, 3600);
      
      logger.info(`✅ Smart Account ${result.isDeployed ? 'deployed' : 'predicted'} for ${userAddress}: ${result.address}`);
      return result.address;
    } catch (error) {
      logger.error(`❌ Failed to deploy Smart Account for ${userAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get Smart Account address (deployed or predicted)
   */
  async getSmartAccountAddress(
    userAddress: string,
    options?: { forceRefresh?: boolean }
  ): Promise<string> {
    try {
      const cacheKey = `deployed_account_${userAddress}`;

      if (options?.forceRefresh) {
        await redis.del(cacheKey);
        logger.info(`🔄 Smart Account cache cleared for ${userAddress}`);
      }

      logger.info(`🔍 Getting Smart Account address for ${userAddress}`);
      
      // Check cache first
      const cached = await redis.getJSON<{ address: string; predictedAt?: string; deployedAt?: string; isDeployed: boolean }>(
        cacheKey
      );
      
      if (cached) {
        logger.info(`📦 Found cached address: ${cached.address}`);
        return cached.address;
      }

      // Get predicted address from Smart Account service
      const result = await this.smartAccountService.createSmartAccount(userAddress);
      
      // Cache the predicted address
      await redis.setJSON(cacheKey, {
        address: result.address,
        predictedAt: new Date().toISOString(),
        isDeployed: result.isDeployed
      }, 3600);
      
      return result.address;
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
      const smartAccountAddress = await this.getSmartAccountAddress(userAddress);
      const signerWallet = privateKey ? new Wallet(privateKey, this.provider) : this.testWalletService.getPrimaryWallet();
      
      const txHash = await this.smartAccountService.executeTransaction(
        smartAccountAddress,
        to,
        value,
        data,
        signerWallet
      );
      
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
    sessionKeyConfig: SessionKeyConfig,
    privateKey?: string
  ): Promise<string> {
    try {
      const smartAccountAddress = await this.getSmartAccountAddress(userAddress);
      const ownerWallet = privateKey ? new Wallet(privateKey, this.provider) : this.testWalletService.getPrimaryWallet();
      
      const txHash = await this.smartAccountService.createSessionKey(
        smartAccountAddress,
        sessionKeyConfig,
        ownerWallet
      );
      
      // Update session key wallet
      this.sessionKeyWallet.updateSessionKeyStatus(sessionKeyConfig.sessionKey, true);
      
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
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      const feeData = await this.provider.getFeeData();

      return {
        chainId: Number(network.chainId),
        name: network.name,
        blockNumber,
        gasPrice: feeData.gasPrice?.toString() || '0',
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
      const balance = await this.provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error(`❌ Failed to get balance for ${address}:`, error);
      throw error;
    }
  }

  /**
   * Get token price using market data providers
   */
  async getTokenPrice(tokenAddress: string, tokenSymbol?: string): Promise<number> {
    if (!this.marketDataService) {
      throw new Error('Market data service not configured');
    }

    const symbol = (tokenSymbol || this.tokenSymbolCache.get(tokenAddress.toLowerCase()))?.toUpperCase();

    if (!symbol) {
      throw new Error(`Token symbol unknown for address ${tokenAddress}`);
    }

    const metrics = await this.marketDataService.getTokenMetrics(symbol);

    if (!metrics || metrics.price === undefined || metrics.price === null) {
      throw new Error(`Market data unavailable for token ${symbol}`);
    }

    // Cache symbol for subsequent lookups
    this.tokenSymbolCache.set(tokenAddress.toLowerCase(), symbol);
    return metrics.price;
  }

  /**
   * Get token 24h volume from market data
   */
  async getToken24hVolume(tokenAddress: string, tokenSymbol?: string): Promise<number> {
    if (!this.marketDataService) {
      throw new Error('Market data service not configured');
    }

    const symbol = (tokenSymbol || this.tokenSymbolCache.get(tokenAddress.toLowerCase()))?.toUpperCase();

    if (!symbol) {
      throw new Error(`Token symbol unknown for address ${tokenAddress}`);
    }

    const metrics = await this.marketDataService.getTokenMetrics(symbol);

    if (!metrics || metrics.volume24h === undefined || metrics.volume24h === null) {
      throw new Error(`Market data unavailable for token ${symbol}`);
    }

    this.tokenSymbolCache.set(tokenAddress.toLowerCase(), symbol);
    return metrics.volume24h;
  }

  /**
   * Execute smart account transaction via session key
   */
  async executeSmartAccountTransaction(params: {
    smartAccountAddress: string;
    sessionKeyAddress: string;
    targetContract: string;
    callData: string;
    value: string;
  }): Promise<string> {
    try {
      logger.info(`Executing smart account transaction:`);
      logger.info(`  Smart Account: ${params.smartAccountAddress}`);
      logger.info(`  Session Key: ${params.sessionKeyAddress}`);
      logger.info(`  Target: ${params.targetContract}`);
      logger.info(`  Value: ${params.value}`);
      
      // Get session key wallet
      const sessionKeyWallet = this.sessionKeyWallet.getSessionKeyWallet(params.sessionKeyAddress);
      if (!sessionKeyWallet) {
        throw new Error(`Session key wallet not found: ${params.sessionKeyAddress}`);
      }
      
      // Check session key permissions
      if (!this.sessionKeyWallet.canSpend(params.sessionKeyAddress, params.value)) {
        throw new Error('Session key spending limit exceeded');
      }
      
      if (!this.sessionKeyWallet.canCallFunction(params.sessionKeyAddress, params.targetContract, params.callData.slice(0, 10))) {
        throw new Error('Session key not authorized for this function call');
      }
      
      // Execute via session key
      const txHash = await this.smartAccountService.executeWithSessionKey(
        params.smartAccountAddress,
        params.targetContract,
        params.value,
        params.callData,
        sessionKeyWallet
      );
      
      // Update spent amount
      this.sessionKeyWallet.updateSpentAmount(params.sessionKeyAddress, params.value);
      
      logger.info(`✅ Smart account transaction executed: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error('Failed to execute smart account transaction:', error);
      throw error;
    }
  }

  async getTokenAllowance(
    tokenAddress: string,
    owner: string,
    spender: string
  ): Promise<bigint> {
    try {
      const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const allowance = await tokenContract.allowance(owner, spender);
      return BigInt(allowance.toString());
    } catch (error) {
      logger.error(`Failed to read allowance for token ${tokenAddress}`, error);
      throw error;
    }
  }

  /**
   * Generate session key for automated trading
   */
  async generateAutomationSessionKey(
    smartAccountAddress: string,
    validityHours: number = 24,
    limitAmountEth: string = '1.0',
    tradingContracts: string[] = []
  ): Promise<{ address: string; privateKey: string }> {
    try {
      const sessionKeyInfo = await this.sessionKeyWallet.createAutomatedTradingKey(
        smartAccountAddress,
        validityHours,
        limitAmountEth,
        tradingContracts
      );
      
      return {
        address: sessionKeyInfo.address,
        privateKey: sessionKeyInfo.privateKey
      };
    } catch (error) {
      logger.error('Failed to generate automation session key:', error);
      throw error;
    }
  }
  
  /**
   * Get Smart Account info
   */
  async getSmartAccountInfo(smartAccountAddress: string): Promise<any> {
    try {
      return await this.smartAccountService.getAccountInfo(smartAccountAddress);
    } catch (error) {
      logger.error(`Failed to get Smart Account info for ${smartAccountAddress}:`, error);
      throw error;
    }
  }

  async getWalletTokenBalances(
    address: string,
    tokenAddresses: string[] = [],
    forceRefresh: boolean = false
  ): Promise<WalletBalances | null> {
    if (!address) {
      return null;
    }

    try {
      return await this.balanceService.getWalletBalances(address, tokenAddresses, forceRefresh);
    } catch (error) {
      logger.error(`Failed to get wallet token balances for ${address}:`, error);
      return null;
    }
  }
  
  /**
   * Get test wallet service (for development/testing)
   */
  getTestWalletService(): TestWalletService {
    return this.testWalletService;
  }
  
  /**
   * Get session key wallet service
   */
  getSessionKeyWallet(): SessionKeyWallet {
    return this.sessionKeyWallet;
  }
  
  /**
   * Get bundler service
   */
  getUserOperationBundler(): UserOperationBundler {
    return this.userOperationBundler;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      
      // Check all services
      const [smartAccountHealthy, testWalletHealthy, bundlerHealthy] = await Promise.all([
        this.smartAccountService.healthCheck(),
        this.testWalletService.healthCheck(),
        this.userOperationBundler.healthCheck()
      ]);
      
      return smartAccountHealthy && testWalletHealthy && bundlerHealthy;
    } catch (error) {
      logger.error('❌ Blockchain service health check failed:', error);
      return false;
    }
  }
}

class SmartAccountClientImpl implements SmartAccountClient {
  private provider: ethers.JsonRpcProvider;
  private userAddress: string;
  private wallet?: Wallet;
  private factoryContract?: Contract;
  private smartAccountContract?: Contract;

  constructor(provider: ethers.JsonRpcProvider, userAddress: string, privateKey?: string) {
    this.provider = provider;
    this.userAddress = userAddress;
    
    if (privateKey) {
      this.wallet = new Wallet(privateKey, provider);
    }

    if (env.ACCOUNT_FACTORY_ADDRESS) {
      this.factoryContract = new Contract(
        env.ACCOUNT_FACTORY_ADDRESS,
        ACCOUNT_FACTORY_ABI,
        this.wallet || provider
      );
    }
  }

  async deployAccount(): Promise<string> {
    if (!this.factoryContract) {
      throw new Error('Account Factory contract not available');
    }

    try {
      // Generate deterministic salt based on user address  
      const deterministicSalt = ethers.keccak256(ethers.toUtf8Bytes(this.userAddress));
      
      const tx = await this.factoryContract.createAccount(this.userAddress, deterministicSalt);
      const receipt = await tx.wait();
      
      // Find AccountCreated event
      const accountCreatedEvent = receipt.logs.find((log: any) => {
        try {
          const parsedLog = this.factoryContract!.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          return parsedLog?.name === 'AccountCreated';
        } catch {
          return false;
        }
      });

      if (accountCreatedEvent) {
        const parsedLog = this.factoryContract.interface.parseLog({
          topics: accountCreatedEvent.topics,
          data: accountCreatedEvent.data
        });
        const accountAddress = parsedLog?.args.account;
        
        // Initialize smart account contract
        this.smartAccountContract = new Contract(
          accountAddress,
          SMART_ACCOUNT_ABI,
          this.wallet || this.provider
        );
        
        return accountAddress;
      }

      throw new Error('Account deployment failed - no AccountCreated event found');
    } catch (error) {
      logger.error('Failed to deploy account:', error);
      throw error;
    }
  }

  async getAccountAddress(): Promise<string> {
    if (!this.factoryContract) {
      throw new Error('Account Factory contract not available');
    }

    try {
      // Check if already deployed
      const existingAccount = await this.factoryContract.getAccount(this.userAddress);
      
      if (existingAccount !== ethers.ZeroAddress) {
        return existingAccount;
      }

      // Return predicted address using deterministic salt and manual call
      const deterministicSalt = ethers.keccak256(ethers.toUtf8Bytes(this.userAddress));
      
      const getAddressSelector = ethers.id('getAddress(address,bytes32)').slice(0, 10);
      const callData = ethers.concat([
        getAddressSelector,
        ethers.zeroPadValue(this.userAddress, 32),
        deterministicSalt
      ]);
      
      const result = await this.provider.call({
        to: this.factoryContract.getAddress(),
        data: callData
      });
      
      return ethers.getAddress('0x' + result.slice(-40));
    } catch (error) {
      logger.error('Failed to get account address:', error);
      throw error;
    }
  }

  async executeTransaction(to: string, value: string, data: string): Promise<string> {
    if (!this.smartAccountContract) {
      throw new Error('Smart Account contract not initialized');
    }

    try {
      const tx = await this.smartAccountContract.execute(
        to,
        ethers.parseEther(value || '0'),
        data || '0x'
      );
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      logger.error('Failed to execute transaction:', error);
      throw error;
    }
  }

  async executeBatch(destinations: string[], values: string[], datas: string[]): Promise<string> {
    if (!this.smartAccountContract) {
      throw new Error('Smart Account contract not initialized');
    }

    try {
      const ethValues = values.map(v => ethers.parseEther(v || '0'));
      const tx = await this.smartAccountContract.executeBatch(destinations, ethValues, datas);
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      logger.error('Failed to execute batch:', error);
      throw error;
    }
  }

  async createSessionKey(sessionKeyConfig: any): Promise<string> {
    if (!this.smartAccountContract) {
      throw new Error('Smart Account contract not initialized');
    }

    try {
      const tx = await this.smartAccountContract.createSessionKey(
        sessionKeyConfig.sessionKey,
        sessionKeyConfig.validUntil,
        ethers.parseEther(sessionKeyConfig.limitAmount),
        sessionKeyConfig.allowedTargets,
        sessionKeyConfig.allowedFunctions
      );
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      logger.error('Failed to create session key:', error);
      throw error;
    }
  }

  async revokeSessionKey(sessionKey: string): Promise<string> {
    if (!this.smartAccountContract) {
      throw new Error('Smart Account contract not initialized');
    }

    try {
      const tx = await this.smartAccountContract.revokeSessionKey(sessionKey);
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      logger.error('Failed to revoke session key:', error);
      throw error;
    }
  }

  async getAccountInfo(): Promise<{
    address: string;
    owner: string;
    nonce: string;
    balance: string;
    isDeployed: boolean;
  }> {
    try {
      const address = await this.getAccountAddress();
      const balance = await this.provider.getBalance(address);
      
      // Check if deployed
      const code = await this.provider.getCode(address);
      const isDeployed = code !== '0x';
      
      let owner = this.userAddress;
      let nonce = '0';
      
      if (isDeployed && this.smartAccountContract) {
        try {
          owner = await this.smartAccountContract.owner();
          nonce = (await this.smartAccountContract.getNonce()).toString();
        } catch {
          // Contract might not have these methods
        }
      }

      return {
        address,
        owner,
        nonce,
        balance: ethers.formatEther(balance),
        isDeployed
      };
    } catch (error) {
      logger.error('Failed to get account info:', error);
      throw error;
    }
  }
}

export { RealBlockchainService };
export const blockchainService = new RealBlockchainService();
export default blockchainService;
