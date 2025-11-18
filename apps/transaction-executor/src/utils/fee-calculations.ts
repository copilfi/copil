import { UserRole, VolumeTier, RoleDiscount, FEE_CONSTANTS } from '@copil/database';

/**
 * Pure function: Calculate volume-based fee percentage
 * @param amount - Transaction amount in wei
 * @param usdValue - Amount value in USD
 * @param volumeTiers - Volume tier configuration
 * @returns Fee percentage based on volume
 */
export function calculateVolumeFeePercentage(usdValue: number, volumeTiers: VolumeTier[]): number {
  const tier = volumeTiers.find((tier) => usdValue >= tier.minAmount && usdValue < tier.maxAmount);

  return tier?.feePercentage ?? FEE_CONSTANTS.DEFAULT_MAX_FEE;
}

/**
 * Pure function: Apply role-based discount
 * @param baseFeePercentage - Base fee percentage
 * @param userRole - User role
 * @param roleDiscounts - Role discount configuration
 * @returns Discounted fee percentage
 */
export function applyRoleDiscount(
  baseFeePercentage: number,
  userRole: UserRole,
  roleDiscounts: RoleDiscount[],
): number {
  const discount = roleDiscounts.find((d) => d.role === userRole);
  const multiplier = discount?.discountMultiplier ?? 1;

  return baseFeePercentage * multiplier;
}

/**
 * Pure function: Calculate deployment cost for first transaction
 * @param chain - Blockchain network
 * @param deploymentCosts - Deployment cost configuration
 * @param isFirstTransaction - Whether this is the first transaction
 * @returns Deployment cost in wei
 */
export function calculateDeploymentCost(
  chain: string,
  deploymentCosts: Record<string, bigint>,
  isFirstTransaction: boolean,
): bigint {
  if (!isFirstTransaction) return 0n;

  return deploymentCosts[chain.toLowerCase()] ?? 0n;
}

/**
 * Pure function: Calculate fee amount from percentage
 * @param amount - Original amount in wei
 * @param feePercentage - Fee percentage (e.g., 0.5 for 0.5%)
 * @returns Fee amount in wei
 */
export function calculateFeeAmount(amount: bigint, feePercentage: number): bigint {
  return (
    (amount * BigInt(Math.floor(feePercentage * FEE_CONSTANTS.BASIS_POINTS))) /
    BigInt(FEE_CONSTANTS.BASIS_POINTS)
  );
}

/**
 * Pure function: Validate fee percentage against limits
 * @param feePercentage - Calculated fee percentage
 * @param maxFeePercentage - Maximum allowed fee percentage
 * @returns Validated fee percentage
 */
export function validateFeePercentage(
  feePercentage: number,
  maxFeePercentage: number = FEE_CONSTANTS.DEFAULT_MAX_FEE,
): number {
  return Math.min(Math.max(feePercentage, 0), maxFeePercentage);
}

/**
 * Pure function: Convert token amount to USD value
 * @param amount - Token amount in wei
 * @param tokenPrice - Token price in USD
 * @param tokenDecimals - Token decimals
 * @returns USD value
 */
export function convertToUSD(
  amount: bigint,
  tokenPrice: number,
  tokenDecimals: number = 18,
): number {
  const divisor = BigInt(10 ** tokenDecimals);
  const tokenAmount = Number(amount) / Number(divisor);
  return tokenAmount * tokenPrice;
}

/**
 * Pure function: Check if fee is above minimum threshold
 * @param feeAmount - Fee amount in wei
 * @param minFeeThreshold - Minimum fee threshold in wei
 * @returns Whether fee should be applied
 */
export function shouldApplyFee(feeAmount: bigint, minFeeThreshold: bigint): boolean {
  return feeAmount >= minFeeThreshold;
}
