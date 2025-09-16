import { ethers, Wallet, Contract, Provider } from 'ethers';
import { BlockchainLogger } from '../utils/Logger';

const logger = BlockchainLogger.getInstance();

// Enhanced Smart Account Factory ABI
const SMART_ACCOUNT_FACTORY_ABI = [
  'function createAccount(address owner, bytes32 salt) external returns (address)',
  'function getAccount(address owner) external view returns (address)', 
  'function getAddress(address owner, bytes32 salt) external view returns (address)',
  'function accountImplementation() external view returns (address)',
  'event AccountCreated(address indexed account, address indexed owner, bytes32 indexed salt)',
  'error AccountAlreadyExists(address account)',
  'error InvalidOwner()'
];

// Enhanced Smart Account ABI with ERC-4337 support
const SMART_ACCOUNT_ABI = [
  // Basic execution functions
  'function execute(address dest, uint256 value, bytes calldata func) external',
  'function executeBatch(address[] calldata dest, uint256[] calldata values, bytes[] calldata func) external',
  
  // Session key management
  'function createSessionKey(address sessionKey, uint256 validUntil, uint256 limitAmount, address[] calldata allowedTargets, bytes4[] calldata allowedFunctions) external',
  'function revokeSessionKey(address sessionKey) external',
  'function isValidSessionKey(address sessionKey) external view returns (bool)',
  'function getSessionKeyInfo(address sessionKey) external view returns (uint256 validUntil, uint256 limitAmount, uint256 spentAmount)',
  
  // Account management
  'function owner() external view returns (address)',
  'function getNonce() external view returns (uint256)',
  'function getNonce(uint192 key) external view returns (uint256)',
  'function initialize(address owner) external',
  'function isOwner(address account) external view returns (bool)',
  
  // ERC-4337 UserOperation functions
  'function validateUserOp(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp, bytes32 userOpHash, uint256 missingAccountFunds) external returns (uint256 validationData)',
  
  // Events
  'event SessionKeyCreated(address indexed sessionKey, uint256 validUntil, uint256 limitAmount)',
  'event SessionKeyRevoked(address indexed sessionKey)',
  'event Executed(address indexed target, uint256 value, bytes data)'
];

// Entry Point ABI for ERC-4337
const ENTRY_POINT_ABI = [
  'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] calldata ops, address beneficiary) external',
  'function getNonce(address sender, uint192 key) external view returns (uint256 nonce)',
  'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp) external view returns (bytes32)',
  'function simulateValidation(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp) external',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
];

export interface SmartAccountConfig {
  factoryAddress: string;
  entryPointAddress: string;
  rpcUrl: string;
  chainId: number;
}

export interface UserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
}

export interface SessionKeyConfig {
  sessionKey: string;
  validUntil: number;
  limitAmount: string;
  allowedTargets: string[];
  allowedFunctions: string[];
}

export class SmartAccountService {
  private provider: ethers.JsonRpcProvider;
  private config: SmartAccountConfig;
  private factoryContract: Contract;
  private entryPointContract: Contract;
  private accounts: Map<string, Contract> = new Map();

  constructor(config: SmartAccountConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    
    this.factoryContract = new Contract(
      config.factoryAddress,
      SMART_ACCOUNT_FACTORY_ABI,
      this.provider
    );
    
    this.entryPointContract = new Contract(
      config.entryPointAddress,
      ENTRY_POINT_ABI,
      this.provider
    );

    logger.info(`SmartAccountService initialized for chain ${config.chainId}`);
  }

  /**
   * Create a new Smart Account
   */
  async createSmartAccount(
    ownerAddress: string,
    signerWallet?: Wallet
  ): Promise<{ address: string; isDeployed: boolean }> {
    try {
      // Generate deterministic salt based on owner (must match RealBlockchainService)
      const salt = ethers.keccak256(ethers.toUtf8Bytes(ownerAddress));
      
      // Get predicted address using manual contract call to avoid ethers.js method conflict
      const getAddressSelector = ethers.id('getAddress(address,bytes32)').slice(0, 10);
      const callData = ethers.concat([
        getAddressSelector,
        ethers.zeroPadValue(ownerAddress, 32),
        salt
      ]);
      
      const result = await this.provider.call({
        to: this.config.factoryAddress,
        data: callData
      });
      
      const predictedAddress = ethers.getAddress('0x' + result.slice(-40));
      
      // Check if already deployed
      const code = await this.provider.getCode(predictedAddress);
      const isDeployed = code !== '0x';

      if (isDeployed) {
        logger.info(`Smart Account already exists at ${predictedAddress}`);
        return { address: predictedAddress, isDeployed: true };
      }

      // Deploy if signer wallet is provided
      if (signerWallet) {
        const factoryWithSigner = this.factoryContract.connect(signerWallet);
        
        logger.info(`Deploying Smart Account for owner ${ownerAddress}...`);
        const tx = await factoryWithSigner.createAccount(ownerAddress, salt);
        const receipt = await tx.wait();
        
        // Find AccountCreated event
        const accountCreatedEvent = receipt.logs.find((log: any) => {
          try {
            const parsedLog = this.factoryContract.interface.parseLog({
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
          
          const deployedAddress = parsedLog?.args.account;
          logger.info(`✅ Smart Account deployed at ${deployedAddress}`);
          
          return { address: deployedAddress, isDeployed: true };
        }

        throw new Error('Deployment failed: AccountCreated event not found');
      }

      // Return predicted address if no signer
      return { address: predictedAddress, isDeployed: false };
      
    } catch (error: unknown) {
      logger.error(`Failed to create Smart Account for ${ownerAddress}:`, error as Error);
      throw error;
    }
  }

  /**
   * Get Smart Account contract instance
   */
  async getSmartAccount(accountAddress: string, signer?: Wallet): Promise<Contract> {
    const cacheKey = `${accountAddress}_${signer?.address || 'readonly'}`;
    
    if (this.accounts.has(cacheKey)) {
      return this.accounts.get(cacheKey)!;
    }

    const contract = new Contract(
      accountAddress,
      SMART_ACCOUNT_ABI,
      signer || this.provider
    );

    this.accounts.set(cacheKey, contract);
    return contract;
  }

  /**
   * Execute transaction through Smart Account
   */
  async executeTransaction(
    smartAccountAddress: string,
    target: string,
    value: string,
    data: string,
    signerWallet?: Wallet
  ): Promise<string> {
    try {
      const smartAccount = await this.getSmartAccount(smartAccountAddress, signerWallet);
      
      if (!signerWallet) {
        throw new Error('Signer wallet required for transaction execution');
      }

      logger.info(`Executing transaction on Smart Account ${smartAccountAddress}`);
      logger.info(`  Target: ${target}`);
      logger.info(`  Value: ${value} ETH`);
      
      const tx = await smartAccount.execute(
        target,
        ethers.parseEther(value || '0'),
        data || '0x'
      );
      
      const receipt = await tx.wait();
      logger.info(`✅ Transaction executed: ${receipt.hash}`);
      
      return receipt.hash;
    } catch (error: unknown) {
      logger.error(`Failed to execute transaction on Smart Account ${smartAccountAddress}:`, error as Error);
      throw error;
    }
  }

  /**
   * Execute batch transactions through Smart Account
   */
  async executeBatch(
    smartAccountAddress: string,
    transactions: Array<{ target: string; value: string; data: string }>,
    signerWallet?: Wallet
  ): Promise<string> {
    try {
      const smartAccount = await this.getSmartAccount(smartAccountAddress, signerWallet);
      
      if (!signerWallet) {
        throw new Error('Signer wallet required for batch execution');
      }

      const targets = transactions.map(tx => tx.target);
      const values = transactions.map(tx => ethers.parseEther(tx.value || '0'));
      const datas = transactions.map(tx => tx.data || '0x');

      logger.info(`Executing batch transaction with ${transactions.length} calls`);
      
      const tx = await smartAccount.executeBatch(targets, values, datas);
      const receipt = await tx.wait();
      
      logger.info(`✅ Batch transaction executed: ${receipt.hash}`);
      return receipt.hash;
    } catch (error: unknown) {
      logger.error(`Failed to execute batch transaction:`, error as Error);
      throw error;
    }
  }

  /**
   * Create session key for automated operations
   */
  async createSessionKey(
    smartAccountAddress: string,
    config: SessionKeyConfig,
    ownerWallet: Wallet
  ): Promise<string> {
    try {
      const smartAccount = await this.getSmartAccount(smartAccountAddress, ownerWallet);
      
      logger.info(`Creating session key for Smart Account ${smartAccountAddress}`);
      logger.info(`  Session Key: ${config.sessionKey}`);
      logger.info(`  Valid Until: ${new Date(config.validUntil * 1000).toISOString()}`);
      logger.info(`  Limit Amount: ${config.limitAmount} ETH`);
      
      const tx = await smartAccount.createSessionKey(
        config.sessionKey,
        config.validUntil,
        ethers.parseEther(config.limitAmount),
        config.allowedTargets,
        config.allowedFunctions
      );
      
      const receipt = await tx.wait();
      logger.info(`✅ Session key created: ${receipt.hash}`);
      
      return receipt.hash;
    } catch (error: unknown) {
      logger.error(`Failed to create session key:`, error as Error);
      throw error;
    }
  }

  /**
   * Revoke session key
   */
  async revokeSessionKey(
    smartAccountAddress: string,
    sessionKey: string,
    ownerWallet: Wallet
  ): Promise<string> {
    try {
      const smartAccount = await this.getSmartAccount(smartAccountAddress, ownerWallet);
      
      logger.info(`Revoking session key ${sessionKey} for Smart Account ${smartAccountAddress}`);
      
      const tx = await smartAccount.revokeSessionKey(sessionKey);
      const receipt = await tx.wait();
      
      logger.info(`✅ Session key revoked: ${receipt.hash}`);
      return receipt.hash;
    } catch (error: unknown) {
      logger.error(`Failed to revoke session key:`, error as Error);
      throw error;
    }
  }

  /**
   * Get Smart Account info
   */
  async getAccountInfo(smartAccountAddress: string): Promise<{
    address: string;
    owner: string;
    nonce: string;
    balance: string;
    isDeployed: boolean;
  }> {
    try {
      const balance = await this.provider.getBalance(smartAccountAddress);
      const code = await this.provider.getCode(smartAccountAddress);
      const isDeployed = code !== '0x';
      
      let owner = ethers.ZeroAddress;
      let nonce = '0';
      
      if (isDeployed) {
        try {
          const smartAccount = await this.getSmartAccount(smartAccountAddress);
          owner = await smartAccount.owner();
          nonce = (await smartAccount.getNonce()).toString();
        } catch (error: unknown) {
          logger.warn(`Could not get owner/nonce for ${smartAccountAddress}:`, error);
        }
      }

      return {
        address: smartAccountAddress,
        owner,
        nonce,
        balance: ethers.formatEther(balance),
        isDeployed
      };
    } catch (error: unknown) {
      logger.error(`Failed to get account info for ${smartAccountAddress}:`, error as Error);
      throw error;
    }
  }

  /**
   * Check if session key is valid
   */
  async isValidSessionKey(
    smartAccountAddress: string,
    sessionKey: string
  ): Promise<boolean> {
    try {
      const smartAccount = await this.getSmartAccount(smartAccountAddress);
      return await smartAccount.isValidSessionKey(sessionKey);
    } catch (error: unknown) {
      logger.error(`Failed to check session key validity:`, error as Error);
      return false;
    }
  }

  /**
   * Create UserOperation for ERC-4337
   */
  async createUserOperation(
    smartAccountAddress: string,
    target: string,
    value: string,
    data: string,
    sessionKeyWallet?: Wallet
  ): Promise<UserOperation> {
    try {
      // Get nonce
      const nonce = await this.entryPointContract.getNonce(smartAccountAddress, 0);
      
      // Encode call data
      const smartAccountInterface = new ethers.Interface(SMART_ACCOUNT_ABI);
      const callData = smartAccountInterface.encodeFunctionData('execute', [
        target,
        ethers.parseEther(value || '0'),
        data || '0x'
      ]);

      // Get network and gas estimates
      const network = await this.provider.getNetwork();
      const feeData = await this.provider.getFeeData();
      
      // Check if account is deployed
      const code = await this.provider.getCode(smartAccountAddress);
      const isDeployed = code !== '0x';
      
      let initCode = '0x';
      if (!isDeployed) {
        // Create initCode for deployment
        const factoryInterface = this.factoryContract.interface;
        const salt = ethers.keccak256(ethers.toUtf8Bytes(`${smartAccountAddress}_deploy`));
        const createCallData = factoryInterface.encodeFunctionData('createAccount', [
          smartAccountAddress, // This should be the owner address
          salt
        ]);
        initCode = ethers.concat([this.config.factoryAddress, createCallData]);
      }

      // Handle SEI network (1329) fee compatibility - use legacy gas price
      let maxFeePerGas: string;
      let maxPriorityFeePerGas: string;

      if (Number(network.chainId) === 1329) {
        // SEI network doesn't support EIP-1559, use legacy gas price
        const gasPrice = feeData.gasPrice?.toString() || '20000000000';
        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = gasPrice;
        logger.info(`Using SEI legacy gas price: ${gasPrice}`);
      } else {
        // Other networks support EIP-1559
        maxFeePerGas = feeData.maxFeePerGas?.toString() || '20000000000';
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas?.toString() || '1000000000';
      }

      const userOp: UserOperation = {
        sender: smartAccountAddress,
        nonce: nonce.toString(),
        initCode,
        callData,
        callGasLimit: '200000',
        verificationGasLimit: '500000',
        preVerificationGas: '50000',
        maxFeePerGas,
        maxPriorityFeePerGas,
        paymasterAndData: '0x',
        signature: '0x'
      };

      // Sign the UserOperation if wallet is provided
      if (sessionKeyWallet) {
        const userOpHash = await this.entryPointContract.getUserOpHash(userOp);
        const signature = await sessionKeyWallet.signMessage(ethers.getBytes(userOpHash));
        userOp.signature = signature;
      }

      return userOp;
    } catch (error: unknown) {
      logger.error('Failed to create UserOperation:', error as Error);
      throw error;
    }
  }

  /**
   * Submit UserOperation to bundler
   */
  async submitUserOperation(
    userOp: UserOperation,
    beneficiary?: string
  ): Promise<string> {
    try {
      logger.info('Submitting UserOperation to entry point...');
      
      // For now, we'll simulate bundler functionality
      // In production, this would go through a bundler service
      const adminWallet = new Wallet(process.env.PRIVATE_KEY!, this.provider);
      const entryPointWithSigner = this.entryPointContract.connect(adminWallet);
      
      const tx = await entryPointWithSigner.handleOps(
        [userOp],
        beneficiary || adminWallet.address
      );
      
      const receipt = await tx.wait();
      logger.info(`✅ UserOperation submitted: ${receipt.hash}`);
      
      return receipt.hash;
    } catch (error: unknown) {
      logger.error('Failed to submit UserOperation:', error as Error);
      throw error;
    }
  }

  /**
   * Execute transaction via session key
   */
  async executeWithSessionKey(
    smartAccountAddress: string,
    target: string,
    value: string,
    data: string,
    sessionKeyWallet: Wallet
  ): Promise<string> {
    try {
      // Create UserOperation
      const userOp = await this.createUserOperation(
        smartAccountAddress,
        target,
        value,
        data,
        sessionKeyWallet
      );

      // Submit to bundler/entry point
      return await this.submitUserOperation(userOp);
    } catch (error: unknown) {
      logger.error('Failed to execute with session key:', error as Error);
      throw error;
    }
  }

  /**
   * Get network info
   */
  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      const feeData = await this.provider.getFeeData();

      // Handle SEI network compatibility
      let maxFeePerGas: string;
      let maxPriorityFeePerGas: string;

      if (Number(network.chainId) === 1329) {
        // SEI network doesn't support EIP-1559, use legacy gas price
        const gasPrice = feeData.gasPrice?.toString() || '0';
        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = gasPrice;
      } else {
        // Other networks support EIP-1559
        maxFeePerGas = feeData.maxFeePerGas?.toString() || '0';
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas?.toString() || '0';
      }

      return {
        chainId: Number(network.chainId),
        name: network.name,
        blockNumber,
        gasPrice: feeData.gasPrice?.toString() || '0',
        maxFeePerGas,
        maxPriorityFeePerGas
      };
    } catch (error: unknown) {
      logger.error('Failed to get network info:', error as Error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      
      // Check if factory contract is accessible
      await this.factoryContract.accountImplementation();
      
      return true;
    } catch (error: unknown) {
      logger.error('SmartAccountService health check failed:', error as Error);
      return false;
    }
  }
}

export default SmartAccountService;