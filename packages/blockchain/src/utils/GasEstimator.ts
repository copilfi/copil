import { ethers, TransactionRequest } from 'ethers';
import type { GasEstimate, NetworkConfig } from '../types';
import { SEI_BLOCK_TIME } from '../constants/networks';

export class AdvancedGasEstimator {
  private gasHistory: Array<{ block: number; gasPrice: bigint; timestamp: number }> = [];
  private readonly historySize = 20;

  constructor(
    private provider: ethers.Provider,
    private networkConfig: NetworkConfig
  ) {}

  /**
   * Get comprehensive gas estimate with multiple strategies
   */
  async getComprehensiveEstimate(tx: TransactionRequest): Promise<{
    conservative: GasEstimate;
    standard: GasEstimate;
    fast: GasEstimate;
    recommended: GasEstimate;
  }> {
    const [feeData, gasLimit] = await Promise.all([
      this.provider.getFeeData(),
      this.estimateGasLimit(tx)
    ]);

    const baseGasPrice = feeData.gasPrice || BigInt('1000000000');
    const baseFee = feeData.maxFeePerGas || baseGasPrice;
    const priorityFee = feeData.maxPriorityFeePerGas || BigInt('1000000000');

    // Conservative estimate (slow but cheap)
    const conservative = this.buildEstimate(gasLimit, {
      gasPrice: baseGasPrice,
      maxFeePerGas: baseFee,
      maxPriorityFeePerGas: priorityFee / BigInt(2)
    });

    // Standard estimate (balanced)
    const standard = this.buildEstimate(gasLimit, {
      gasPrice: baseGasPrice * BigInt(110) / BigInt(100),
      maxFeePerGas: baseFee * BigInt(120) / BigInt(100),
      maxPriorityFeePerGas: priorityFee
    });

    // Fast estimate (quick confirmation)
    const fast = this.buildEstimate(gasLimit, {
      gasPrice: baseGasPrice * BigInt(150) / BigInt(100),
      maxFeePerGas: baseFee * BigInt(200) / BigInt(100),
      maxPriorityFeePerGas: priorityFee * BigInt(200) / BigInt(100)
    });

    // Sei-optimized recommendation (considering 390ms block time)
    const recommended = this.getSeiOptimizedEstimate(gasLimit, baseFee, priorityFee);

    return { conservative, standard, fast, recommended };
  }

  /**
   * Estimate gas limit with retry logic
   */
  private async estimateGasLimit(tx: TransactionRequest): Promise<bigint> {
    try {
      const estimate = await this.provider.estimateGas(tx);
      // Add 20% buffer for safety
      return estimate * BigInt(120) / BigInt(100);
    } catch (error) {
      console.warn('Gas estimation failed, using fallback:', error);
      return this.getFallbackGasLimit(tx);
    }
  }

  /**
   * Get fallback gas limit based on transaction type
   */
  private getFallbackGasLimit(tx: TransactionRequest): bigint {
    if (!tx.data || tx.data === '0x') {
      return BigInt(21000); // Simple transfer
    }
    
    const dataLength = (tx.data.length - 2) / 2; // Remove 0x and convert to bytes
    
    if (dataLength < 100) {
      return BigInt(50000); // Small contract interaction
    } else if (dataLength < 1000) {
      return BigInt(100000); // Medium contract interaction
    } else {
      return BigInt(200000); // Complex contract interaction
    }
  }

  /**
   * Build gas estimate object
   */
  private buildEstimate(gasLimit: bigint, fees: {
    gasPrice: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }): GasEstimate {
    const estimatedCost = gasLimit * fees.maxFeePerGas;

    return {
      gasLimit: gasLimit.toString(),
      gasPrice: fees.gasPrice.toString(),
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      estimatedCost: ethers.formatEther(estimatedCost)
    };
  }

  /**
   * Get Sei-optimized gas estimate
   */
  private getSeiOptimizedEstimate(
    gasLimit: bigint,
    baseFee: bigint,
    priorityFee: bigint
  ): GasEstimate {
    // Sei's fast finality allows for more aggressive pricing
    // We can use slightly higher gas prices for near-instant confirmation
    const optimizedMaxFee = baseFee * BigInt(130) / BigInt(100);
    const optimizedPriorityFee = priorityFee * BigInt(110) / BigInt(100);
    const optimizedGasPrice = optimizedMaxFee;

    return this.buildEstimate(gasLimit, {
      gasPrice: optimizedGasPrice,
      maxFeePerGas: optimizedMaxFee,
      maxPriorityFeePerGas: optimizedPriorityFee
    });
  }

  /**
   * Track gas prices over time
   */
  async updateGasHistory(): Promise<void> {
    try {
      const feeData = await this.provider.getFeeData();
      const blockNumber = await this.provider.getBlockNumber();
      
      this.gasHistory.push({
        block: blockNumber,
        gasPrice: feeData.gasPrice || BigInt(0),
        timestamp: Date.now()
      });

      // Keep only recent history
      if (this.gasHistory.length > this.historySize) {
        this.gasHistory = this.gasHistory.slice(-this.historySize);
      }
    } catch (error) {
      console.warn('Failed to update gas history:', error);
    }
  }

  /**
   * Get gas price trend
   */
  getGasPriceTrend(): 'increasing' | 'decreasing' | 'stable' | 'insufficient_data' {
    if (this.gasHistory.length < 3) {
      return 'insufficient_data';
    }

    const recent = this.gasHistory.slice(-5);
    const older = this.gasHistory.slice(-10, -5);
    
    if (older.length === 0) {
      return 'insufficient_data';
    }

    const recentAvg = recent.reduce((sum, item) => sum + item.gasPrice, BigInt(0)) / BigInt(recent.length);
    const olderAvg = older.reduce((sum, item) => sum + item.gasPrice, BigInt(0)) / BigInt(older.length);
    
    const changePercent = Number((recentAvg - olderAvg) * BigInt(100) / olderAvg);
    
    if (changePercent > 5) return 'increasing';
    if (changePercent < -5) return 'decreasing';
    return 'stable';
  }

  /**
   * Get predictive gas price
   */
  getPredictiveGasPrice(): bigint {
    if (this.gasHistory.length < 5) {
      return BigInt('1000000000'); // 1 gwei fallback
    }

    const trend = this.getGasPriceTrend();
    const latestPrice = this.gasHistory[this.gasHistory.length - 1].gasPrice;
    
    switch (trend) {
      case 'increasing':
        return latestPrice * BigInt(115) / BigInt(100); // 15% higher
      case 'decreasing':
        return latestPrice * BigInt(95) / BigInt(100); // 5% lower
      case 'stable':
      default:
        return latestPrice;
    }
  }

  /**
   * Calculate time to confirmation based on gas price
   */
  estimateConfirmationTime(gasPrice: bigint): number {
    // On Sei, confirmation time is ~390ms regardless of gas price
    // But we can provide estimates based on network congestion
    const currentGasPrice = this.gasHistory.length > 0 
      ? this.gasHistory[this.gasHistory.length - 1].gasPrice 
      : BigInt('1000000000');

    if (gasPrice >= currentGasPrice * BigInt(150) / BigInt(100)) {
      return SEI_BLOCK_TIME; // Next block
    } else if (gasPrice >= currentGasPrice) {
      return SEI_BLOCK_TIME * 2; // 1-2 blocks
    } else {
      return SEI_BLOCK_TIME * 5; // 3-5 blocks
    }
  }

  /**
   * Get gas price percentiles from history
   */
  getGasPricePercentiles(): {
    p10: string;
    p25: string;
    p50: string;
    p75: string;
    p90: string;
  } | null {
    if (this.gasHistory.length < 5) {
      return null;
    }

    const prices = this.gasHistory
      .map(item => item.gasPrice)
      .sort((a, b) => Number(a - b));

    const getPercentile = (p: number): string => {
      const index = Math.floor((prices.length - 1) * p / 100);
      return prices[index].toString();
    };

    return {
      p10: getPercentile(10),
      p25: getPercentile(25),
      p50: getPercentile(50),
      p75: getPercentile(75),
      p90: getPercentile(90)
    };
  }

  /**
   * Get recommended gas price for specific urgency
   */
  getGasPriceForUrgency(urgency: 'low' | 'medium' | 'high' | 'urgent'): bigint {
    const predictivePrice = this.getPredictiveGasPrice();
    
    switch (urgency) {
      case 'low':
        return predictivePrice * BigInt(90) / BigInt(100);
      case 'medium':
        return predictivePrice;
      case 'high':
        return predictivePrice * BigInt(130) / BigInt(100);
      case 'urgent':
        return predictivePrice * BigInt(200) / BigInt(100);
      default:
        return predictivePrice;
    }
  }

  /**
   * Start automatic gas price tracking
   */
  startTracking(intervalMs: number = SEI_BLOCK_TIME * 2): void {
    setInterval(() => {
      this.updateGasHistory();
    }, intervalMs);
  }

  /**
   * Get network-specific gas optimizations
   */
  getNetworkOptimizations(): {
    recommendedGasLimit: bigint;
    optimalGasPrice: bigint;
    fastConfirmationPrice: bigint;
  } {
    const basePrice = this.getPredictiveGasPrice();
    
    return {
      recommendedGasLimit: BigInt(100000), // Conservative default for Sei
      optimalGasPrice: basePrice * BigInt(110) / BigInt(100),
      fastConfirmationPrice: basePrice * BigInt(150) / BigInt(100)
    };
  }
}