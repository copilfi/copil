import { ethers, Wallet, Contract } from 'ethers';
import { 
  UserOperation,
  SmartAccountConfig,
  SessionKeyConfig,
  GasEstimate
} from '../types';
import {
  TransactionError,
  ContractError
} from '../types/errors';
import { SeiProvider } from '../providers/SeiProvider';
import { 
  ENTRY_POINT_ABI,
  ACCOUNT_FACTORY_ABI,
  SMART_ACCOUNT_ABI
} from '../constants/contracts';
import { generateRandomBytes32, computeAccountAddress } from '../utils/AddressUtils';
import { Validator } from '../utils/Validator';
import { logger } from '../utils/Logger';
import { SMART_ACCOUNT_DEFAULTS } from '../constants';

export class SmartAccountClient {
  private entryPointContract: Contract;
  private factoryContract: Contract;
  private smartAccountContract?: Contract;
  private wallet?: Wallet;
  
  constructor(
    private provider: SeiProvider,
    private config: SmartAccountConfig,
    privateKey?: string
  ) {
    // Validate input parameters
    this.validateConfig(config);
    if (privateKey) {
      Validator.validatePrivateKey(privateKey);
    }

    const evmProvider = provider.getEvmProvider();
    
    this.entryPointContract = new Contract(
      config.entryPoint,
      ENTRY_POINT_ABI,
      evmProvider
    );
    
    this.factoryContract = new Contract(
      config.factory,
      ACCOUNT_FACTORY_ABI,
      evmProvider
    );

    if (privateKey) {
      this.wallet = new Wallet(privateKey, evmProvider);
      
      // Connect contracts with signer
      this.entryPointContract = this.entryPointContract.connect(this.wallet) as Contract;
      this.factoryContract = this.factoryContract.connect(this.wallet) as Contract;
    }

    logger.info('SmartAccountClient initialized', {
      owner: config.owner,
      entryPoint: config.entryPoint,
      factory: config.factory
    });
  }

  /**
   * Validate SmartAccountConfig
   */
  private validateConfig(config: SmartAccountConfig): void {
    Validator.validateRequiredFields(config, ['owner', 'entryPoint', 'factory']);
    Validator.validateAddress(config.owner, 'owner');
    Validator.validateAddress(config.entryPoint, 'entryPoint');
    Validator.validateAddress(config.factory, 'factory');
  }

  /**
   * Deploy or get existing Smart Account
   */
  async deployAccount(): Promise<string> {
    try {
      // Check if account already exists
      const existingAccount = await (this.factoryContract as any).getAccount(this.config.owner);
      
      if (existingAccount !== ethers.ZeroAddress) {
        console.log(`Smart Account already exists: ${existingAccount}`);
        await this.initializeSmartAccountContract(existingAccount);
        return existingAccount;
      }

      // Generate salt if not provided
      const salt = this.config.salt || generateRandomBytes32();
      
      // Predict account address
      const predictedAddress = await (this.factoryContract as any).getAddress?.(this.config.owner, salt);
      console.log(`Predicted Smart Account address: ${predictedAddress}`);

      // Deploy account
      const tx = await (this.factoryContract as any).createAccount(this.config.owner, salt);
      const receipt = await tx.wait();
      
      console.log(`Smart Account deployed in tx: ${receipt.hash}`);
      
      // Find AccountCreated event
      const event = receipt.logs.find((log: any) => {
        const eventSignature = this.factoryContract.interface.getEvent('AccountCreated');
        return eventSignature && log.topics[0] === eventSignature.topicHash;
      });
      
      if (!event) {
        throw new ContractError('AccountCreated event not found in transaction receipt');
      }

      const decodedEvent = this.factoryContract.interface.parseLog(event);
      if (!decodedEvent) {
        throw new ContractError('Failed to decode AccountCreated event');
      }
      const accountAddress = decodedEvent.args.account;
      
      await this.initializeSmartAccountContract(accountAddress);
      
      return accountAddress;
    } catch (error) {
      throw new ContractError('Failed to deploy Smart Account', undefined, error);
    }
  }

  /**
   * Initialize Smart Account contract instance
   */
  private async initializeSmartAccountContract(address: string): Promise<void> {
    const evmProvider = this.provider.getEvmProvider();
    this.smartAccountContract = new Contract(address, SMART_ACCOUNT_ABI, evmProvider);
    
    if (this.wallet) {
      this.smartAccountContract = this.smartAccountContract.connect(this.wallet) as Contract;
    }
  }

  /**
   * Get Smart Account address
   */
  async getAccountAddress(): Promise<string> {
    const account = await this.factoryContract.getAccount(this.config.owner);
    
    if (account === ethers.ZeroAddress) {
      // Return predicted address if not deployed yet
      const salt = this.config.salt || generateRandomBytes32();
      return await (this.factoryContract as any).getAddress?.(this.config.owner, salt);
    }
    
    return account;
  }

  /**
   * Create a new session key
   */
  async createSessionKey(sessionConfig: SessionKeyConfig): Promise<string> {
    if (!this.smartAccountContract) {
      throw new ContractError('Smart Account not initialized');
    }

    // Validate session configuration
    Validator.validateSessionKeyConfig(sessionConfig);

    try {
      logger.info('Creating session key', { 
        sessionKey: sessionConfig.sessionKey,
        validUntil: sessionConfig.validUntil 
      });

      const tx = await this.smartAccountContract!.createSessionKey(
        sessionConfig.sessionKey,
        sessionConfig.validUntil,
        ethers.parseEther(sessionConfig.limitAmount),
        sessionConfig.allowedTargets,
        sessionConfig.allowedFunctions
      );

      const receipt = await tx.wait();
      logger.info('Session key created successfully', { txHash: receipt.hash });
      
      return receipt.hash;
    } catch (error) {
      logger.error('Failed to create session key', error as Error);
      throw new ContractError('Failed to create session key', String(this.smartAccountContract?.target), error);
    }
  }

  /**
   * Revoke a session key
   */
  async revokeSessionKey(sessionKey: string): Promise<string> {
    if (!this.smartAccountContract) {
      throw new ContractError('Smart Account not initialized');
    }

    try {
      const tx = await this.smartAccountContract!.revokeSessionKey(sessionKey);
      const receipt = await tx.wait();
      console.log(`Session key revoked in tx: ${receipt.hash}`);
      
      return receipt.hash;
    } catch (error) {
      throw new ContractError('Failed to revoke session key', String(this.smartAccountContract?.target), error);
    }
  }

  /**
   * Execute a single transaction
   */
  async executeTransaction(
    to: string,
    value: string,
    data: string
  ): Promise<string> {
    if (!this.smartAccountContract) {
      throw new ContractError('Smart Account not initialized');
    }

    try {
      const tx = await (this.smartAccountContract as any).execute(
        to,
        ethers.parseEther(value || '0'),
        data
      );

      const receipt = await tx.wait();
      console.log(`Transaction executed in tx: ${receipt.hash}`);
      
      return receipt.hash;
    } catch (error) {
      throw new TransactionError('Failed to execute transaction', undefined, error);
    }
  }

  /**
   * Execute multiple transactions in batch
   */
  async executeBatch(
    destinations: string[],
    values: string[],
    datas: string[]
  ): Promise<string> {
    if (!this.smartAccountContract) {
      throw new ContractError('Smart Account not initialized');
    }

    try {
      const ethValues = values.map(v => ethers.parseEther(v || '0'));
      
      const tx = await (this.smartAccountContract as any).executeBatch(
        destinations,
        ethValues,
        datas
      );

      const receipt = await tx.wait();
      console.log(`Batch executed in tx: ${receipt.hash}`);
      
      return receipt.hash;
    } catch (error) {
      throw new TransactionError('Failed to execute batch', undefined, error);
    }
  }

  /**
   * Execute automated transaction using session key
   */
  async executeAutomated(
    to: string,
    value: string,
    data: string,
    sessionKey: string
  ): Promise<string> {
    if (!this.smartAccountContract) {
      throw new ContractError('Smart Account not initialized');
    }

    try {
      const tx = await (this.smartAccountContract as any).executeAutomated(
        to,
        ethers.parseEther(value || '0'),
        data,
        sessionKey
      );

      const receipt = await tx.wait();
      console.log(`Automated transaction executed in tx: ${receipt.hash}`);
      
      return receipt.hash;
    } catch (error) {
      throw new TransactionError('Failed to execute automated transaction', undefined, error);
    }
  }

  /**
   * Build UserOperation for ERC-4337
   */
  async buildUserOperation(
    to: string,
    value: string,
    data: string,
    options: {
      nonce?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      callGasLimit?: string;
      verificationGasLimit?: string;
      preVerificationGas?: string;
    } = {}
  ): Promise<UserOperation> {
    try {
      const accountAddress = await this.getAccountAddress();
      
      // Get nonce from EntryPoint
      const nonce = options.nonce || 
        (await (this.entryPointContract as any).getNonce(accountAddress, 0)).toString();

      // Encode call data for Smart Account execution
      const callData = this.smartAccountContract ? 
        (this.smartAccountContract as any).interface.encodeFunctionData('execute', [
          to,
          ethers.parseEther(value || '0'),
          data
        ]) : '0x';

      // Get gas estimates
      const gasEstimate = await this.estimateUserOpGas({
        sender: accountAddress,
        nonce,
        initCode: '0x',
        callData,
        callGasLimit: options.callGasLimit || '100000',
        verificationGasLimit: options.verificationGasLimit || '100000',
        preVerificationGas: options.preVerificationGas || '21000',
        maxFeePerGas: options.maxFeePerGas || '1000000000',
        maxPriorityFeePerGas: options.maxPriorityFeePerGas || '1000000000',
        paymasterAndData: '0x',
        signature: '0x'
      });

      return {
        sender: accountAddress,
        nonce,
        initCode: '0x',
        callData,
        callGasLimit: gasEstimate.gasLimit,
        verificationGasLimit: gasEstimate.gasLimit,
        preVerificationGas: '21000',
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
        paymasterAndData: '0x',
        signature: '0x'
      };
    } catch (error) {
      throw new ContractError('Failed to build UserOperation', undefined, error);
    }
  }

  /**
   * Sign UserOperation
   */
  async signUserOperation(userOp: UserOperation): Promise<UserOperation> {
    if (!this.wallet) {
      throw new ContractError('Wallet not available for signing');
    }

    try {
      // Get UserOperation hash from EntryPoint
      const userOpHash = await (this.entryPointContract as any).getUserOpHash({
        sender: userOp.sender,
        nonce: userOp.nonce,
        initCode: userOp.initCode,
        callData: userOp.callData,
        callGasLimit: userOp.callGasLimit,
        verificationGasLimit: userOp.verificationGasLimit,
        preVerificationGas: userOp.preVerificationGas,
        maxFeePerGas: userOp.maxFeePerGas,
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
        paymasterAndData: userOp.paymasterAndData,
        signature: '0x'
      });

      // Sign the hash
      const signature = await this.wallet.signMessage(ethers.getBytes(userOpHash));

      return {
        ...userOp,
        signature
      };
    } catch (error) {
      throw new ContractError('Failed to sign UserOperation', undefined, error);
    }
  }

  /**
   * Submit UserOperation to EntryPoint
   */
  async submitUserOperation(userOp: UserOperation): Promise<string> {
    try {
      const tx = await (this.entryPointContract as any).handleOps([userOp], this.wallet?.address || this.config.owner);
      const receipt = await tx.wait();
      
      console.log(`UserOperation submitted in tx: ${receipt.hash}`);
      return receipt.hash;
    } catch (error) {
      throw new TransactionError('Failed to submit UserOperation', undefined, error);
    }
  }

  /**
   * Estimate gas for UserOperation
   */
  private async estimateUserOpGas(userOp: Partial<UserOperation>): Promise<GasEstimate> {
    try {
      const feeData = await this.provider.getEvmProvider().getFeeData();
      
      return {
        gasLimit: '200000', // Conservative estimate
        gasPrice: feeData.gasPrice?.toString() || '1000000000',
        maxFeePerGas: feeData.maxFeePerGas?.toString() || '2000000000',
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() || '1000000000',
        estimatedCost: ethers.formatEther(
          BigInt(200000) * (feeData.maxFeePerGas || BigInt(2000000000))
        )
      };
    } catch (error) {
      throw new ContractError('Failed to estimate gas', undefined, error);
    }
  }

  /**
   * Get account info
   */
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
      
      // Check if account is deployed
      const code = await this.provider.getEvmProvider().getCode(address);
      const isDeployed = code !== '0x';
      
      let owner = this.config.owner;
      let nonce = '0';
      
      if (isDeployed && this.smartAccountContract) {
        owner = await (this.smartAccountContract as any).owner();
        nonce = (await (this.smartAccountContract as any).getNonce()).toString();
      }

      return {
        address,
        owner,
        nonce,
        balance,
        isDeployed
      };
    } catch (error) {
      throw new ContractError('Failed to get account info', undefined, error);
    }
  }

  /**
   * Get Smart Account contract instance
   */
  getSmartAccountContract(): Contract | undefined {
    return this.smartAccountContract;
  }

  /**
   * Get EntryPoint contract instance
   */
  getEntryPointContract(): Contract {
    return this.entryPointContract;
  }

  /**
   * Get Factory contract instance
   */
  getFactoryContract(): Contract {
    return this.factoryContract;
  }
}