import { ethers, Wallet, HDNodeWallet } from 'ethers';
import { BlockchainLogger } from '../utils/Logger';

const logger = BlockchainLogger.getInstance();

export interface TestWalletConfig {
  privateKey?: string;
  mnemonic?: string;
  rpcUrl: string;
  chainId: number;
  autoFund?: boolean;
  fundingAmount?: string; // in ETH
}

export interface WalletInfo {
  address: string;
  privateKey: string;
  balance: string;
  nonce: number;
  isContract: boolean;
}

export interface TransactionOptions {
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  value?: string;
}

export class TestWalletService {
  private provider: ethers.JsonRpcProvider;
  private config: TestWalletConfig;
  private primaryWallet: Wallet;
  private derivedWallets: Map<number, Wallet> = new Map();

  constructor(config: TestWalletConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Initialize primary wallet
    if (config.privateKey) {
      this.primaryWallet = new Wallet(config.privateKey, this.provider);
    } else if (config.mnemonic) {
      const hdWallet = HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(config.mnemonic));
      this.primaryWallet = hdWallet.connect(this.provider);
    } else {
      // Generate random wallet for testing
      this.primaryWallet = Wallet.createRandom().connect(this.provider);
      logger.warn('⚠️  Generated random test wallet. Private key will not persist!');
      logger.info(`Generated wallet address: ${this.primaryWallet.address}`);
      logger.info(`Generated private key: ${this.primaryWallet.privateKey}`);
    }

    logger.info(`TestWalletService initialized`);
    logger.info(`Primary wallet: ${this.primaryWallet.address}`);
    logger.info(`Chain ID: ${config.chainId}`);
  }

  /**
   * Get primary wallet instance
   */
  getPrimaryWallet(): Wallet {
    return this.primaryWallet;
  }

  /**
   * Get derived wallet by index (for HD wallets)
   */
  getDerivedWallet(index: number): Wallet {
    if (this.derivedWallets.has(index)) {
      return this.derivedWallets.get(index)!;
    }

    let derivedWallet: Wallet;

    if (this.config.mnemonic) {
      const hdWallet = HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(this.config.mnemonic));
      const path = `m/44'/60'/0'/0/${index}`;
      derivedWallet = hdWallet.derivePath(path).connect(this.provider) as ethers.Wallet;
    } else {
      // For non-HD wallets, create deterministic wallets based on primary key
      const derivedKey = ethers.keccak256(
        ethers.solidityPacked(['bytes32', 'uint256'], [this.primaryWallet.privateKey, index])
      );
      derivedWallet = new Wallet(derivedKey, this.provider);
    }

    this.derivedWallets.set(index, derivedWallet);
    logger.info(`Created derived wallet ${index}: ${derivedWallet.address}`);
    
    return derivedWallet;
  }

  /**
   * Get wallet information
   */
  async getWalletInfo(wallet?: Wallet): Promise<WalletInfo> {
    const targetWallet = wallet || this.primaryWallet;

    try {
      const [balance, nonce, code] = await Promise.all([
        this.provider.getBalance(targetWallet.address),
        this.provider.getTransactionCount(targetWallet.address),
        this.provider.getCode(targetWallet.address)
      ]);

      return {
        address: targetWallet.address,
        privateKey: targetWallet.privateKey,
        balance: ethers.formatEther(balance),
        nonce,
        isContract: code !== '0x'
      };
    } catch (error: unknown) {
      logger.error(`Failed to get wallet info for ${targetWallet.address}:`, error as Error);
      throw error;
    }
  }

  /**
   * Fund wallet with native tokens (for testing on local/testnet)
   */
  async fundWallet(
    targetAddress: string,
    amountEth: string = '1.0',
    fromWallet?: Wallet
  ): Promise<string> {
    try {
      const senderWallet = fromWallet || this.primaryWallet;
      
      logger.info(`Funding wallet ${targetAddress} with ${amountEth} ETH`);
      
      const tx = await senderWallet.sendTransaction({
        to: targetAddress,
        value: ethers.parseEther(amountEth),
        gasLimit: 21000
      });

      const receipt = await tx.wait();
      logger.info(`✅ Funded wallet ${targetAddress}: ${receipt?.hash}`);
      
      return receipt?.hash || tx.hash;
    } catch (error: unknown) {
      logger.error(`Failed to fund wallet ${targetAddress}:`, error as Error);
      throw error;
    }
  }

  /**
   * Send native tokens
   */
  async sendNativeToken(
    toAddress: string,
    amountEth: string,
    fromWallet?: Wallet,
    options?: TransactionOptions
  ): Promise<string> {
    try {
      const senderWallet = fromWallet || this.primaryWallet;
      
      logger.info(`Sending ${amountEth} ETH from ${senderWallet.address} to ${toAddress}`);

      const txRequest: any = {
        to: toAddress,
        value: ethers.parseEther(amountEth)
      };

      // Add gas options if provided
      if (options?.gasLimit) txRequest.gasLimit = options.gasLimit;
      if (options?.gasPrice) txRequest.gasPrice = options.gasPrice;
      if (options?.maxFeePerGas) txRequest.maxFeePerGas = options.maxFeePerGas;
      if (options?.maxPriorityFeePerGas) txRequest.maxPriorityFeePerGas = options.maxPriorityFeePerGas;

      const tx = await senderWallet.sendTransaction(txRequest);
      const receipt = await tx.wait();
      
      logger.info(`✅ Sent ${amountEth} ETH: ${receipt?.hash}`);
      return receipt?.hash || tx.hash;
    } catch (error: unknown) {
      logger.error(`Failed to send native token:`, error as Error);
      throw error;
    }
  }

  /**
   * Send transaction to contract
   */
  async sendContractTransaction(
    contractAddress: string,
    data: string,
    value?: string,
    fromWallet?: Wallet,
    options?: TransactionOptions
  ): Promise<string> {
    try {
      const senderWallet = fromWallet || this.primaryWallet;
      
      logger.info(`Sending contract transaction to ${contractAddress}`);
      logger.info(`From: ${senderWallet.address}`);
      logger.info(`Data: ${data.slice(0, 50)}...`);
      if (value) logger.info(`Value: ${value} ETH`);

      const txRequest: any = {
        to: contractAddress,
        data,
        value: value ? ethers.parseEther(value) : 0
      };

      // Add gas options if provided
      if (options?.gasLimit) txRequest.gasLimit = options.gasLimit;
      if (options?.gasPrice) txRequest.gasPrice = options.gasPrice;
      if (options?.maxFeePerGas) txRequest.maxFeePerGas = options.maxFeePerGas;
      if (options?.maxPriorityFeePerGas) txRequest.maxPriorityFeePerGas = options.maxPriorityFeePerGas;

      const tx = await senderWallet.sendTransaction(txRequest);
      const receipt = await tx.wait();
      
      logger.info(`✅ Contract transaction sent: ${receipt?.hash}`);
      return receipt?.hash || tx.hash;
    } catch (error: unknown) {
      logger.error(`Failed to send contract transaction:`, error as Error);
      throw error;
    }
  }

  /**
   * Sign message
   */
  async signMessage(message: string, wallet?: Wallet): Promise<string> {
    try {
      const signerWallet = wallet || this.primaryWallet;
      
      logger.info(`Signing message with wallet ${signerWallet.address}`);
      logger.debug(`Message: ${message}`);
      
      const signature = await signerWallet.signMessage(message);
      logger.info(`✅ Message signed`);
      
      return signature;
    } catch (error: unknown) {
      logger.error('Failed to sign message:', error as Error);
      throw error;
    }
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(
    domain: any,
    types: any,
    value: any,
    wallet?: Wallet
  ): Promise<string> {
    try {
      const signerWallet = wallet || this.primaryWallet;
      
      logger.info(`Signing typed data with wallet ${signerWallet.address}`);
      
      const signature = await signerWallet.signTypedData(domain, types, value);
      logger.info(`✅ Typed data signed`);
      
      return signature;
    } catch (error: unknown) {
      logger.error('Failed to sign typed data:', error as Error);
      throw error;
    }
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(
    to: string,
    data?: string,
    value?: string,
    fromWallet?: Wallet
  ): Promise<bigint> {
    try {
      const senderWallet = fromWallet || this.primaryWallet;
      
      const gasEstimate = await this.provider.estimateGas({
        from: senderWallet.address,
        to,
        data: data || '0x',
        value: value ? ethers.parseEther(value) : 0
      });

      logger.debug(`Gas estimate: ${gasEstimate.toString()}`);
      return gasEstimate;
    } catch (error: unknown) {
      logger.error('Failed to estimate gas:', error as Error);
      throw error;
    }
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<any> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      return receipt;
    } catch (error: unknown) {
      logger.error(`Failed to get transaction receipt for ${txHash}:`, error as Error);
      throw error;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(txHash: string, confirmations: number = 1): Promise<any> {
    try {
      logger.info(`Waiting for ${confirmations} confirmation(s) for ${txHash}`);
      
      const receipt = await this.provider.waitForTransaction(txHash, confirmations);
      
      logger.info(`✅ Transaction confirmed: ${txHash}`);
      return receipt;
    } catch (error: unknown) {
      logger.error(`Failed to wait for transaction ${txHash}:`, error as Error);
      throw error;
    }
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<{
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    isEIP1559: boolean;
  }> {
    try {
      const network = await this.provider.getNetwork();
      const feeData = await this.provider.getFeeData();

      // Handle SEI network (1329) - doesn't support EIP-1559
      if (Number(network.chainId) === 1329) {
        const gasPrice = feeData.gasPrice?.toString();
        return {
          gasPrice,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
          isEIP1559: false // SEI uses legacy gas pricing
        };
      }

      return {
        gasPrice: feeData.gasPrice?.toString(),
        maxFeePerGas: feeData.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
        isEIP1559: !!feeData.maxFeePerGas
      };
    } catch (error: unknown) {
      logger.error('Failed to get gas price:', error as Error);
      throw error;
    }
  }

  /**
   * Create multiple test wallets
   */
  createTestWallets(count: number): Wallet[] {
    const wallets: Wallet[] = [];
    
    for (let i = 0; i < count; i++) {
      if (this.config.mnemonic) {
        // Use derived wallets for HD wallet
        wallets.push(this.getDerivedWallet(i));
      } else {
        // Create random wallets
        const wallet = Wallet.createRandom().connect(this.provider);
        wallets.push(wallet);
      }
    }
    
    logger.info(`Created ${count} test wallets`);
    return wallets;
  }

  /**
   * Fund multiple wallets (useful for testing)
   */
  async fundMultipleWallets(
    addresses: string[],
    amountEthPerWallet: string = '1.0'
  ): Promise<string[]> {
    const txHashes: string[] = [];
    
    for (const address of addresses) {
      try {
        const txHash = await this.fundWallet(address, amountEthPerWallet);
        txHashes.push(txHash);
      } catch (error: unknown) {
        logger.error(`Failed to fund wallet ${address}:`, error as Error);
        txHashes.push(''); // Add empty string for failed transactions
      }
    }
    
    return txHashes;
  }

  /**
   * Get network information
   */
  async getNetworkInfo(): Promise<{
    chainId: number;
    name: string;
    blockNumber: number;
    gasPrice: string;
    isEIP1559: boolean;
  }> {
    try {
      const [network, blockNumber, feeData] = await Promise.all([
        this.provider.getNetwork(),
        this.provider.getBlockNumber(),
        this.provider.getFeeData()
      ]);

      return {
        chainId: Number(network.chainId),
        name: network.name,
        blockNumber,
        gasPrice: feeData.gasPrice?.toString() || '0',
        isEIP1559: Number(network.chainId) === 1329 ? false : !!feeData.maxFeePerGas
      };
    } catch (error: unknown) {
      logger.error('Failed to get network info:', error as Error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.derivedWallets.clear();
    logger.info('TestWalletService cleaned up');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      await this.getWalletInfo();
      return true;
    } catch (error: unknown) {
      logger.error('TestWalletService health check failed:', error as Error);
      return false;
    }
  }

  /**
   * Get primary wallet balance in ETH
   */
  async getBalance(wallet?: Wallet): Promise<string> {
    const targetWallet = wallet || this.primaryWallet;
    const balance = await this.provider.getBalance(targetWallet.address);
    return ethers.formatEther(balance);
  }

  /**
   * Check if wallet has sufficient balance
   */
  async hasSufficientBalance(
    requiredAmountEth: string,
    wallet?: Wallet
  ): Promise<boolean> {
    try {
      const balance = await this.getBalance(wallet);
      const required = parseFloat(requiredAmountEth);
      const available = parseFloat(balance);
      
      return available >= required;
    } catch (error: unknown) {
      logger.error('Failed to check balance:', error as Error);
      return false;
    }
  }

  /**
   * Log wallet statistics
   */
  async logWalletStats(): Promise<void> {
    try {
      const info = await this.getWalletInfo();
      const networkInfo = await this.getNetworkInfo();
      
      logger.info('=== Wallet Statistics ===');
      logger.info(`Address: ${info.address}`);
      logger.info(`Balance: ${info.balance} ETH`);
      logger.info(`Nonce: ${info.nonce}`);
      logger.info(`Network: ${networkInfo.name} (${networkInfo.chainId})`);
      logger.info(`Block: ${networkInfo.blockNumber}`);
      logger.info(`Gas Price: ${ethers.formatUnits(networkInfo.gasPrice, 'gwei')} Gwei`);
      logger.info('========================');
    } catch (error: unknown) {
      logger.error('Failed to log wallet stats:', error as Error);
    }
  }
}

export default TestWalletService;