import { ethers, Wallet, Contract } from 'ethers';
import { BlockchainLogger } from '../utils/Logger';

const logger = BlockchainLogger.getInstance();

export interface FeeConfiguration {
  swap: number;           // 0.002 = %0.2
  dcaExecution: number;   // 0.0075 = %0.75
  conditionalOrder: number; // 0.005 = %0.5
  aiStrategy: number;     // 0.01 = %1.0
}

export interface FeeDistribution {
  treasury: number;   // 0.4 = %40 - Platform development
  liquidity: number;  // 0.3 = %30 - Liquidity pool
  team: number;       // 0.2 = %20 - Team
  rewards: number;    // 0.1 = %10 - User rewards
}

export interface FeeCalculation {
  originalAmount: string;
  feeAmount: string;
  netAmount: string;
  feePercentage: number;
  feeType: 'swap' | 'dcaExecution' | 'conditionalOrder' | 'aiStrategy';
}

export interface TreasuryTransaction {
  id: string;
  timestamp: number;
  feeType: 'swap' | 'dcaExecution' | 'conditionalOrder' | 'aiStrategy';
  originalAmount: string;
  feeAmount: string;
  userAddress: string;
  transactionHash: string;
  tokenAddress: string;
  distribution: {
    treasury: string;
    liquidity: string;
    team: string;
    rewards: string;
  };
}

export interface RevenueStats {
  totalFees: string;
  dailyFees: string;
  monthlyFees: string;
  feesByType: {
    swap: string;
    dcaExecution: string;
    conditionalOrder: string;
    aiStrategy: string;
  };
  transactionCount: number;
  averageFeePerTransaction: string;
}

export class FeeCollectorService {
  private provider: ethers.Provider;
  private treasuryWallet: Wallet;
  private feeConfig: FeeConfiguration;
  private distributionConfig: FeeDistribution;
  private transactions: Map<string, TreasuryTransaction> = new Map();

  constructor(
    provider: ethers.Provider,
    treasuryPrivateKey: string,
    customFeeConfig?: Partial<FeeConfiguration>,
    customDistribution?: Partial<FeeDistribution>
  ) {
    this.provider = provider;
    this.treasuryWallet = new Wallet(treasuryPrivateKey, provider);
    
    // Default fee configuration
    this.feeConfig = {
      swap: 0.002,          // 0.2%
      dcaExecution: 0.0075, // 0.75%
      conditionalOrder: 0.005, // 0.5%
      aiStrategy: 0.01,     // 1.0%
      ...customFeeConfig
    };

    // Default distribution configuration
    this.distributionConfig = {
      treasury: 0.4,   // 40%
      liquidity: 0.3,  // 30%
      team: 0.2,       // 20%
      rewards: 0.1,    // 10%
      ...customDistribution
    };

    logger.info('FeeCollectorService initialized');
    logger.info(`Treasury address: ${this.treasuryWallet.address}`);
    logger.info(`Fee configuration:`, this.feeConfig);
  }

  /**
   * Calculate fee for a given amount and fee type
   */
  calculateFee(
    amount: string,
    feeType: keyof FeeConfiguration,
    tokenDecimals: number = 18
  ): FeeCalculation {
    const originalAmount = ethers.parseUnits(amount, tokenDecimals);
    const feePercentage = this.feeConfig[feeType];
    const feeAmount = originalAmount * BigInt(Math.floor(feePercentage * 10000)) / BigInt(10000);
    const netAmount = originalAmount - feeAmount;

    return {
      originalAmount: ethers.formatUnits(originalAmount, tokenDecimals),
      feeAmount: ethers.formatUnits(feeAmount, tokenDecimals),
      netAmount: ethers.formatUnits(netAmount, tokenDecimals),
      feePercentage,
      feeType
    };
  }

  /**
   * Calculate distributed amounts for treasury management
   */
  calculateDistribution(feeAmount: string, tokenDecimals: number = 18): {
    treasury: string;
    liquidity: string;
    team: string;
    rewards: string;
  } {
    const totalFee = ethers.parseUnits(feeAmount, tokenDecimals);
    
    const treasuryAmount = totalFee * BigInt(Math.floor(this.distributionConfig.treasury * 10000)) / BigInt(10000);
    const liquidityAmount = totalFee * BigInt(Math.floor(this.distributionConfig.liquidity * 10000)) / BigInt(10000);
    const teamAmount = totalFee * BigInt(Math.floor(this.distributionConfig.team * 10000)) / BigInt(10000);
    const rewardsAmount = totalFee * BigInt(Math.floor(this.distributionConfig.rewards * 10000)) / BigInt(10000);

    return {
      treasury: ethers.formatUnits(treasuryAmount, tokenDecimals),
      liquidity: ethers.formatUnits(liquidityAmount, tokenDecimals),
      team: ethers.formatUnits(teamAmount, tokenDecimals),
      rewards: ethers.formatUnits(rewardsAmount, tokenDecimals)
    };
  }

  /**
   * Collect fee from native token transaction
   */
  async collectNativeFee(
    userAddress: string,
    originalAmount: string,
    feeType: keyof FeeConfiguration,
    metadata: { transactionHash?: string; description?: string } = {}
  ): Promise<TreasuryTransaction> {
    try {
      const feeCalculation = this.calculateFee(originalAmount, feeType);
      
      logger.info(`Collecting ${feeType} fee from ${userAddress}:`);
      logger.info(`  Original: ${feeCalculation.originalAmount} ETH`);
      logger.info(`  Fee: ${feeCalculation.feeAmount} ETH (${(feeCalculation.feePercentage * 100).toFixed(2)}%)`);
      logger.info(`  Net: ${feeCalculation.netAmount} ETH`);

      // In a real implementation, this would trigger the actual fee collection
      // For now, we record the transaction for analytics
      const transactionId = `fee_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const distribution = this.calculateDistribution(feeCalculation.feeAmount);
      
      const treasuryTx: TreasuryTransaction = {
        id: transactionId,
        timestamp: Date.now(),
        feeType,
        originalAmount: feeCalculation.originalAmount,
        feeAmount: feeCalculation.feeAmount,
        userAddress,
        transactionHash: metadata.transactionHash || '',
        tokenAddress: ethers.ZeroAddress, // Native token
        distribution
      };

      this.transactions.set(transactionId, treasuryTx);
      
      logger.info(`✅ Fee collected and recorded: ${transactionId}`);
      return treasuryTx;
    } catch (error: unknown) {
      logger.error(`Failed to collect native fee:`, error as Error);
      throw error;
    }
  }

  /**
   * Collect fee from ERC-20 token transaction
   */
  async collectTokenFee(
    userAddress: string,
    tokenAddress: string,
    originalAmount: string,
    feeType: keyof FeeConfiguration,
    tokenDecimals: number = 18,
    metadata: { transactionHash?: string; description?: string } = {}
  ): Promise<TreasuryTransaction> {
    try {
      const feeCalculation = this.calculateFee(originalAmount, feeType, tokenDecimals);
      
      logger.info(`Collecting ${feeType} fee from ${userAddress} for token ${tokenAddress}:`);
      logger.info(`  Original: ${feeCalculation.originalAmount}`);
      logger.info(`  Fee: ${feeCalculation.feeAmount} (${(feeCalculation.feePercentage * 100).toFixed(2)}%)`);
      logger.info(`  Net: ${feeCalculation.netAmount}`);

      const transactionId = `fee_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const distribution = this.calculateDistribution(feeCalculation.feeAmount, tokenDecimals);
      
      const treasuryTx: TreasuryTransaction = {
        id: transactionId,
        timestamp: Date.now(),
        feeType,
        originalAmount: feeCalculation.originalAmount,
        feeAmount: feeCalculation.feeAmount,
        userAddress,
        transactionHash: metadata.transactionHash || '',
        tokenAddress,
        distribution
      };

      this.transactions.set(transactionId, treasuryTx);
      
      logger.info(`✅ Token fee collected and recorded: ${transactionId}`);
      return treasuryTx;
    } catch (error: unknown) {
      logger.error(`Failed to collect token fee:`, error as Error);
      throw error;
    }
  }

  /**
   * Get current fee configuration
   */
  getFeeConfiguration(): FeeConfiguration {
    return { ...this.feeConfig };
  }

  /**
   * Update fee configuration (admin only)
   */
  updateFeeConfiguration(newConfig: Partial<FeeConfiguration>): void {
    this.feeConfig = { ...this.feeConfig, ...newConfig };
    logger.info('Fee configuration updated:', this.feeConfig);
  }

  /**
   * Get treasury wallet address
   */
  getTreasuryAddress(): string {
    return this.treasuryWallet.address;
  }

  /**
   * Get treasury wallet balance
   */
  async getTreasuryBalance(): Promise<{
    native: string;
    tokens: Array<{ address: string; balance: string; symbol?: string }>;
  }> {
    try {
      const nativeBalance = await this.provider.getBalance(this.treasuryWallet.address);
      
      // In a production system, you'd track which tokens the treasury holds
      return {
        native: ethers.formatEther(nativeBalance),
        tokens: [] // TODO: Implement token balance tracking
      };
    } catch (error: unknown) {
      logger.error('Failed to get treasury balance:', error as Error);
      throw error;
    }
  }

  /**
   * Get revenue statistics
   */
  getRevenueStats(timeframe?: { start: number; end: number }): RevenueStats {
    const transactions = Array.from(this.transactions.values());
    
    let filteredTxs = transactions;
    if (timeframe) {
      filteredTxs = transactions.filter(tx => 
        tx.timestamp >= timeframe.start && tx.timestamp <= timeframe.end
      );
    }

    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);

    const dailyTxs = transactions.filter(tx => tx.timestamp >= oneDayAgo);
    const monthlyTxs = transactions.filter(tx => tx.timestamp >= oneMonthAgo);

    const calculateTotal = (txs: TreasuryTransaction[]) => {
      return txs.reduce((sum, tx) => {
        return sum + parseFloat(tx.feeAmount);
      }, 0).toString();
    };

    const feesByType = {
      swap: calculateTotal(filteredTxs.filter(tx => tx.feeType === 'swap')),
      dcaExecution: calculateTotal(filteredTxs.filter(tx => tx.feeType === 'dcaExecution')),
      conditionalOrder: calculateTotal(filteredTxs.filter(tx => tx.feeType === 'conditionalOrder')),
      aiStrategy: calculateTotal(filteredTxs.filter(tx => tx.feeType === 'aiStrategy'))
    };

    const totalFees = calculateTotal(filteredTxs);
    const averageFee = filteredTxs.length > 0 
      ? (parseFloat(totalFees) / filteredTxs.length).toString()
      : '0';

    return {
      totalFees,
      dailyFees: calculateTotal(dailyTxs),
      monthlyFees: calculateTotal(monthlyTxs),
      feesByType,
      transactionCount: filteredTxs.length,
      averageFeePerTransaction: averageFee
    };
  }

  /**
   * Get all treasury transactions
   */
  getTransactions(limit?: number, offset?: number): TreasuryTransaction[] {
    const transactions = Array.from(this.transactions.values())
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (limit !== undefined) {
      const start = offset || 0;
      return transactions.slice(start, start + limit);
    }
    
    return transactions;
  }

  /**
   * Get transactions by user
   */
  getUserTransactions(userAddress: string): TreasuryTransaction[] {
    return Array.from(this.transactions.values())
      .filter(tx => tx.userAddress.toLowerCase() === userAddress.toLowerCase())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Estimate fees for a transaction before execution
   */
  estimateFees(
    amount: string,
    feeType: keyof FeeConfiguration,
    tokenDecimals: number = 18
  ): {
    estimatedFee: string;
    netAmount: string;
    feePercentage: number;
    savingsVsCompetitors: {
      vs3Commas: string;      // vs $37/month
      vsCryptohopper: string; // vs $19-150/month
      vsShrimpy: string;      // vs $19/month
    };
  } {
    const feeCalc = this.calculateFee(amount, feeType, tokenDecimals);
    const feeAmount = parseFloat(feeCalc.feeAmount);
    
    // Calculate savings vs monthly subscriptions
    // Assuming user does 100 transactions per month
    const monthlyTxCount = 100;
    const monthlyCostCopil = feeAmount * monthlyTxCount;
    
    return {
      estimatedFee: feeCalc.feeAmount,
      netAmount: feeCalc.netAmount,
      feePercentage: feeCalc.feePercentage,
      savingsVsCompetitors: {
        vs3Commas: Math.max(0, 37 - monthlyCostCopil).toFixed(2),
        vsCryptohopper: Math.max(0, 75 - monthlyCostCopil).toFixed(2), // Average of $19-150
        vsShrimpy: Math.max(0, 34 - monthlyCostCopil).toFixed(2) // Average of $19-49
      }
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.getTreasuryBalance();
      return true;
    } catch (error: unknown) {
      logger.error('FeeCollectorService health check failed:', error as Error);
      return false;
    }
  }

  /**
   * Export revenue data for accounting
   */
  exportRevenueData(format: 'json' | 'csv' = 'json'): string {
    const transactions = this.getTransactions();
    
    if (format === 'json') {
      return JSON.stringify(transactions, null, 2);
    } else {
      // CSV format
      const headers = 'ID,Timestamp,Fee Type,Original Amount,Fee Amount,User Address,Transaction Hash,Token Address';
      const rows = transactions.map(tx => 
        `${tx.id},${tx.timestamp},${tx.feeType},${tx.originalAmount},${tx.feeAmount},${tx.userAddress},${tx.transactionHash},${tx.tokenAddress}`
      );
      return [headers, ...rows].join('\n');
    }
  }
}

export default FeeCollectorService;