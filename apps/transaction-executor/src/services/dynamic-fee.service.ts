import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FeeCalculationResult,
  FeeBreakdown,
  FeeConfig,
  FeeLogData,
  DEFAULT_VOLUME_TIERS,
  DEFAULT_ROLE_DISCOUNTS,
  FEE_CONSTANTS,
  FeeLog,
} from '@copil/database';
import {
  calculateVolumeFeePercentage,
  applyRoleDiscount,
  calculateDeploymentCost,
  calculateFeeAmount,
  validateFeePercentage,
  convertToUSD,
  shouldApplyFee,
} from '../utils/fee-calculations';

/**
 * Dynamic Fee Service with Clean Code Architecture
 * Orchestrates fee calculation using pure functions
 */
@Injectable()
export class DynamicFeeService {
  private readonly logger = new Logger(DynamicFeeService.name);
  private feeConfig: FeeConfig;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(FeeLog)
    private readonly feeLogRepository: Repository<FeeLog>,
  ) {
    this.feeConfig = this.loadFeeConfiguration();
    this.validateTreasuryAddresses();
  }

  /**
   * Main entry point for fee calculation
   * @param amount - Transaction amount in wei
   * @param chain - Blockchain network
   * @param userRole - User role for discounts
   * @param isFirstTransaction - Whether this is the first transaction
   * @returns Fee calculation result with full breakdown
   */
  public calculateFee(
    amount: bigint,
    chain: string,
    userRole: string,
    isFirstTransaction: boolean,
  ): FeeCalculationResult {
    this.logger.debug(`Calculating fee for amount: ${amount}, chain: ${chain}, role: ${userRole}`);

    // Calculate base fee using volume tiers
    const usdValue = this.estimateUSDValue(amount, chain);
    const baseFeePercentage = calculateVolumeFeePercentage(usdValue, this.feeConfig.volumeTiers);

    // Apply role discount
    const discountedFeePercentage = applyRoleDiscount(
      baseFeePercentage,
      userRole as any,
      DEFAULT_ROLE_DISCOUNTS,
    );

    // Validate against maximum limits
    const finalFeePercentage = validateFeePercentage(
      discountedFeePercentage,
      this.feeConfig.maxFeePercentage,
    );

    // Calculate deployment cost
    const deploymentCost = calculateDeploymentCost(
      chain,
      this.feeConfig.deploymentCosts,
      isFirstTransaction,
    );

    // Calculate transaction fee
    const transactionFeeAmount = calculateFeeAmount(amount, finalFeePercentage);
    const totalFeeAmount = transactionFeeAmount + deploymentCost;

    // Check minimum threshold
    if (!shouldApplyFee(totalFeeAmount, this.getMinFeeThreshold())) {
      return this.createZeroFeeResult(amount);
    }

    // Create detailed breakdown
    const feeBreakdown: FeeBreakdown = {
      transactionFee: transactionFeeAmount,
      deploymentFee: deploymentCost,
      roleDiscount: 1 - discountedFeePercentage / baseFeePercentage,
      volumeDiscount: 1 - finalFeePercentage / FEE_CONSTANTS.DEFAULT_MAX_FEE,
    };

    return {
      feeAmount: totalFeeAmount,
      feePercentage: finalFeePercentage,
      netAmount: amount - totalFeeAmount,
      feeBreakdown,
    };
  }

  /**
   * Get treasury address for fee collection
   * @param chain - Blockchain network
   * @returns Treasury address for the chain
   */
  public getTreasuryAddress(chain: string): string {
    const address = this.feeConfig.treasuryAddresses[chain.toLowerCase()];
    if (!address) {
      throw new Error(`No treasury address configured for chain: ${chain}`);
    }
    return address;
  }

  /**
   * Log fee collection for analytics and compliance
   * @param feeData - Fee collection data to log
   */
  public async logFeeCollection(feeData: Omit<FeeLogData, 'createdAt'>): Promise<void> {
    try {
      await this.feeLogRepository.save(feeData);
      this.logger.debug(`Fee logged: ${feeData.feeAmount} for user ${feeData.userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to log fee collection: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw - logging failure shouldn't block transactions
    }
  }

  /**
   * Get fee configuration for external services
   * @returns Current fee configuration
   */
  public getFeeConfig(): FeeConfig {
    return { ...this.feeConfig };
  }

  /**
   * Load fee configuration from environment and defaults
   * @returns Fee configuration object
   */
  private loadFeeConfiguration(): FeeConfig {
    const maxFeePercentage = parseFloat(
      this.configService.get<string>('MAX_FEE_PERCENTAGE', '0.5'),
    );

    return {
      maxFeePercentage,
      volumeTiers: DEFAULT_VOLUME_TIERS,
      deploymentCosts: this.loadDeploymentCosts(),
      treasuryAddresses: this.loadTreasuryAddresses(),
    };
  }

  /**
   * Load deployment costs from environment
   * @returns Deployment costs per chain
   */
  private loadDeploymentCosts(): Record<string, bigint> {
    return {
      ethereum: BigInt(
        this.configService.get<string>('DEPLOYMENT_COST_ETHEREUM', '50000000000000000'),
      ),
      arbitrum: BigInt(
        this.configService.get<string>('DEPLOYMENT_COST_ARBITRUM', '5000000000000000'),
      ),
      base: BigInt(this.configService.get<string>('DEPLOYMENT_COST_BASE', '5000000000000000')),
      polygon: BigInt(
        this.configService.get<string>('DEPLOYMENT_COST_POLYGON', '1000000000000000'),
      ),
      bsc: BigInt(this.configService.get<string>('DEPLOYMENT_COST_BSC', '3000000000000000')),
      avalanche: BigInt(
        this.configService.get<string>('DEPLOYMENT_COST_AVALANCHE', '4000000000000000'),
      ),
      optimism: BigInt(
        this.configService.get<string>('DEPLOYMENT_COST_OPTIMISM', '6000000000000000'),
      ),
      linea: BigInt(this.configService.get<string>('DEPLOYMENT_COST_LINEA', '4000000000000000')),
      sei: BigInt(this.configService.get<string>('DEPLOYMENT_COST_SEI', '2000000000000000')),
    };
  }

  /**
   * Load treasury addresses from environment
   * @returns Treasury addresses per chain
   */
  private loadTreasuryAddresses(): Record<string, string> {
    const addresses: Record<string, string> = {};

    const chains = [
      'ethereum',
      'arbitrum',
      'base',
      'polygon',
      'bsc',
      'avalanche',
      'optimism',
      'linea',
      'sei',
    ];

    for (const chain of chains) {
      const address = this.configService.get<string>(`TREASURY_ADDRESS_${chain.toUpperCase()}`);
      if (address) {
        addresses[chain] = address;
      }
    }

    return addresses;
  }

  /**
   * Validate treasury addresses on startup
   */
  private validateTreasuryAddresses(): void {
    const missingChains = Object.keys(this.feeConfig.deploymentCosts).filter(
      (chain) => !this.feeConfig.treasuryAddresses[chain],
    );

    if (missingChains.length > 0) {
      this.logger.warn(`Missing treasury addresses for chains: ${missingChains.join(', ')}`);
    }
  }

  /**
   * Estimate USD value for volume calculation
   * @param amount - Amount in wei
   * @param chain - Blockchain network
   * @returns Estimated USD value
   */
  private estimateUSDValue(amount: bigint, chain: string): number {
    // Simplified estimation - in production, use real price oracle
    const ethPriceUSD = 2000; // Default ETH price
    const tokenDecimals = 18;

    return convertToUSD(amount, ethPriceUSD, tokenDecimals);
  }

  /**
   * Get minimum fee threshold from configuration
   * @returns Minimum fee threshold in wei
   */
  private getMinFeeThreshold(): bigint {
    return BigInt(this.configService.get<string>('MIN_FEE_THRESHOLD', '1000000000000000000')); // 1 token
  }

  /**
   * Create zero fee result for amounts below threshold
   * @param amount - Original amount
   * @returns Zero fee calculation result
   */
  private createZeroFeeResult(amount: bigint): FeeCalculationResult {
    return {
      feeAmount: 0n,
      feePercentage: 0,
      netAmount: amount,
      feeBreakdown: {
        transactionFee: 0n,
        deploymentFee: 0n,
        roleDiscount: 0,
        volumeDiscount: 0,
      },
    };
  }
}
