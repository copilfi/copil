import { ethers, TransactionRequest, TransactionResponse } from 'ethers';
import type { 
  SeiTransaction, 
  UserOperation, 
  GasEstimate
} from '../types';
import { TransactionError } from '../types';
import { SEI_BLOCK_TIME } from '../constants/networks';

/**
 * Transaction builder for Sei network
 */
export class TransactionBuilder {
  private tx: Partial<TransactionRequest> = {};
  
  constructor() {
    this.tx = {
      type: 2, // EIP-1559
      gasLimit: '21000',
      maxFeePerGas: '2000000000', // 2 gwei
      maxPriorityFeePerGas: '1000000000', // 1 gwei
    };
  }

  to(address: string): TransactionBuilder {
    this.tx.to = address;
    return this;
  }

  value(amount: string): TransactionBuilder {
    this.tx.value = ethers.parseEther(amount);
    return this;
  }

  data(calldata: string): TransactionBuilder {
    this.tx.data = calldata;
    return this;
  }

  gasLimit(limit: string): TransactionBuilder {
    this.tx.gasLimit = limit;
    return this;
  }

  maxFeePerGas(fee: string): TransactionBuilder {
    this.tx.maxFeePerGas = fee;
    return this;
  }

  maxPriorityFeePerGas(fee: string): TransactionBuilder {
    this.tx.maxPriorityFeePerGas = fee;
    return this;
  }

  nonce(n: number): TransactionBuilder {
    this.tx.nonce = n;
    return this;
  }

  build(): TransactionRequest {
    return { ...this.tx } as TransactionRequest;
  }

  static create(): TransactionBuilder {
    return new TransactionBuilder();
  }
}

/**
 * Gas estimation utilities
 */
export class GasEstimator {
  constructor(private provider: ethers.Provider) {}

  /**
   * Estimate gas for a transaction with Sei-specific optimizations
   */
  async estimateGas(tx: TransactionRequest): Promise<GasEstimate> {
    try {
      // Get current gas price data
      const feeData = await this.provider.getFeeData();
      
      // Estimate gas limit
      let gasLimit: bigint;
      try {
        gasLimit = await this.provider.estimateGas(tx);
        // Add 20% buffer for safety
        gasLimit = gasLimit * BigInt(120) / BigInt(100);
      } catch (error) {
        // If estimation fails, use conservative defaults
        gasLimit = BigInt(200000);
      }

      // Sei has fast finality, so we can use more aggressive gas pricing
      const baseGasPrice = feeData.gasPrice || BigInt('1000000000');
      const maxFeePerGas = feeData.maxFeePerGas || baseGasPrice * BigInt(2);
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || baseGasPrice;

      const estimatedCost = gasLimit * maxFeePerGas;

      return {
        gasLimit: gasLimit.toString(),
        gasPrice: baseGasPrice.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        estimatedCost: ethers.formatEther(estimatedCost)
      };
    } catch (error) {
      throw new Error(`Gas estimation failed: ${error}`);
    }
  }

  /**
   * Get optimal gas price for fast confirmation on Sei
   */
  async getOptimalGasPrice(): Promise<{
    gasPrice: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }> {
    const feeData = await this.provider.getFeeData();
    
    // Sei's ~390ms block time allows for aggressive gas pricing
    const baseGasPrice = feeData.gasPrice || BigInt('1000000000');
    
    return {
      gasPrice: (baseGasPrice * BigInt(110) / BigInt(100)).toString(), // 10% above base
      maxFeePerGas: (baseGasPrice * BigInt(150) / BigInt(100)).toString(), // 50% above base
      maxPriorityFeePerGas: (baseGasPrice * BigInt(105) / BigInt(100)).toString() // 5% above base
    };
  }

  /**
   * Calculate gas cost in USD (requires price oracle)
   */
  async calculateGasCostUSD(gasUsed: string, gasPrice: string, seiPriceUSD: number): Promise<number> {
    const gasCostWei = BigInt(gasUsed) * BigInt(gasPrice);
    const gasCostSei = parseFloat(ethers.formatEther(gasCostWei));
    return gasCostSei * seiPriceUSD;
  }
}

/**
 * Transaction monitoring and retry logic
 */
export class TransactionMonitor {
  constructor(private provider: ethers.Provider) {}

  /**
   * Wait for transaction with timeout and retry logic
   */
  async waitForTransaction(
    hash: string,
    confirmations: number = 1,
    timeout: number = 30000
  ): Promise<TransactionResponse> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const receipt = await this.provider.getTransactionReceipt(hash);
        
        if (receipt) {
          const currentBlock = await this.provider.getBlockNumber();
          const confirmationCount = currentBlock - receipt.blockNumber + 1;
          
          if (confirmationCount >= confirmations) {
            const tx = await this.provider.getTransaction(hash);
            if (!tx) {
              throw new TransactionError('Transaction not found', hash);
            }
            return tx;
          }
        }
        
        // Wait for one Sei block time before checking again
        await new Promise(resolve => setTimeout(resolve, SEI_BLOCK_TIME));
      } catch (error) {
        if (Date.now() - startTime >= timeout) {
          throw new TransactionError('Transaction timeout', hash, error);
        }
      }
    }
    
    throw new TransactionError('Transaction timeout', hash);
  }

  /**
   * Monitor transaction status changes
   */
  async *watchTransaction(hash: string): AsyncGenerator<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations: number;
    blockNumber?: number;
  }> {
    let lastStatus = 'pending';
    let lastConfirmations = 0;

    while (true) {
      try {
        const receipt = await this.provider.getTransactionReceipt(hash);
        
        if (receipt) {
          const currentBlock = await this.provider.getBlockNumber();
          const confirmations = currentBlock - receipt.blockNumber + 1;
          const status = receipt.status === 1 ? 'confirmed' : 'failed';
          
          if (status !== lastStatus || confirmations !== lastConfirmations) {
            lastStatus = status;
            lastConfirmations = confirmations;
            
            yield {
              status,
              confirmations,
              blockNumber: receipt.blockNumber
            };
            
            if (status === 'failed' || confirmations >= 12) { // Stop after reasonable confirmations
              break;
            }
          }
        } else {
          if (lastStatus !== 'pending') {
            lastStatus = 'pending';
            yield { status: 'pending', confirmations: 0 };
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, SEI_BLOCK_TIME));
      } catch (error) {
        console.warn('Error monitoring transaction:', error);
        await new Promise(resolve => setTimeout(resolve, SEI_BLOCK_TIME * 2));
      }
    }
  }
}

/**
 * UserOperation utilities
 */
export class UserOperationUtils {
  /**
   * Calculate UserOperation hash
   */
  static calculateUserOpHash(
    userOp: UserOperation,
    entryPointAddress: string,
    chainId: number
  ): string {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'address', 'uint256', 'bytes32', 'bytes32',
        'uint256', 'uint256', 'uint256', 'uint256',
        'uint256', 'bytes32'
      ],
      [
        userOp.sender,
        userOp.nonce,
        ethers.keccak256(userOp.initCode),
        ethers.keccak256(userOp.callData),
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
        ethers.keccak256(userOp.paymasterAndData)
      ]
    );
    
    const userOpHash = ethers.keccak256(encoded);
    
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'uint256'],
        [userOpHash, entryPointAddress, chainId]
      )
    );
  }

  /**
   * Validate UserOperation structure
   */
  static validateUserOperation(userOp: UserOperation): boolean {
    const requiredFields = [
      'sender', 'nonce', 'initCode', 'callData',
      'callGasLimit', 'verificationGasLimit', 'preVerificationGas',
      'maxFeePerGas', 'maxPriorityFeePerGas', 'paymasterAndData', 'signature'
    ];

    return requiredFields.every(field => field in userOp && userOp[field as keyof UserOperation] !== undefined);
  }
}

/**
 * Convert between different transaction formats
 */
export class TransactionFormatter {
  /**
   * Convert ethers TransactionResponse to SeiTransaction
   */
  static formatTransaction(tx: TransactionResponse): SeiTransaction {
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
  }

  /**
   * Convert SeiTransaction to ethers-compatible format
   */
  static toEthersTransaction(tx: SeiTransaction): TransactionRequest {
    return {
      to: tx.to,
      from: tx.from,
      value: tx.value,
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      nonce: tx.nonce,
      data: tx.data
    };
  }
}

/**
 * Batch transaction utilities
 */
export class BatchTransactionUtils {
  /**
   * Create multicall data for batch transactions
   */
  static createMulticallData(calls: Array<{ target: string; data: string }>): string {
    // This would encode multiple calls into a single transaction
    // Implementation depends on the specific multicall contract being used
    const multicallInterface = new ethers.Interface([
      'function aggregate((address target, bytes callData)[] calls) returns (uint256 blockNumber, bytes[] returnData)'
    ]);

    return multicallInterface.encodeFunctionData('aggregate', [calls]);
  }

  /**
   * Estimate total gas for batch transaction
   */
  static async estimateBatchGas(
    provider: ethers.Provider,
    calls: Array<{ target: string; data: string; value?: string }>
  ): Promise<string> {
    let totalGas = BigInt(0);

    for (const call of calls) {
      try {
        const gasEstimate = await provider.estimateGas({
          to: call.target,
          data: call.data,
          value: call.value || '0'
        });
        totalGas += gasEstimate;
      } catch (error) {
        // If individual estimation fails, add a conservative estimate
        totalGas += BigInt(50000);
      }
    }

    // Add batch overhead
    totalGas = totalGas * BigInt(110) / BigInt(100);

    return totalGas.toString();
  }
}