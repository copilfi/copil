import { UserRole } from '../entities/user.entity';

/**
 * Fee calculation result with type safety
 */
export interface FeeCalculationResult {
  readonly feeAmount: bigint;
  readonly feePercentage: number;
  readonly netAmount: bigint;
  readonly feeBreakdown: FeeBreakdown;
}

/**
 * Detailed fee breakdown for transparency
 */
export interface FeeBreakdown {
  readonly transactionFee: bigint;
  readonly deploymentFee: bigint;
  readonly roleDiscount: number;
  readonly volumeDiscount: number;
}

/**
 * Fee configuration per chain
 */
export interface FeeConfig {
  readonly maxFeePercentage: number;
  readonly volumeTiers: VolumeTier[];
  readonly deploymentCosts: Record<string, bigint>;
  readonly treasuryAddresses: Record<string, string>;
}

/**
 * Volume-based fee tier configuration
 */
export interface VolumeTier {
  readonly minAmount: number; // USD value
  readonly maxAmount: number; // USD value
  readonly feePercentage: number;
}

/**
 * Role-based discount configuration
 */
export interface RoleDiscount {
  readonly role: UserRole;
  readonly discountMultiplier: number; // 0.0 = free, 0.5 = 50% off, 1.0 = full price
}

/**
 * Fee log entity for tracking and analytics
 */
export interface FeeLogData {
  readonly userId: number;
  readonly chain: string;
  readonly transactionType: string;
  readonly originalAmount: bigint;
  readonly feeAmount: bigint;
  readonly feePercentage: number;
  readonly transactionHash?: string;
  readonly roleDiscount: number;
}

/**
 * Pure function type for fee calculation
 */
export type FeeCalculator = (
  amount: bigint,
  chain: string,
  userRole: UserRole,
  isFirstTransaction: boolean
) => FeeCalculationResult;

/**
 * Treasury address validator type
 */
export type TreasuryValidator = (chain: string, address: string) => boolean;

/**
 * Constants for fee calculation
 */
export const FEE_CONSTANTS = {
  DEFAULT_MAX_FEE: 0.5,
  DEFAULT_MIN_FEE: 0.1,
  BASIS_POINTS: 10000,
} as const;

/**
 * Default volume tiers for progressive pricing
 */
export const DEFAULT_VOLUME_TIERS: VolumeTier[] = [
  { minAmount: 0, maxAmount: 100, feePercentage: 0.5 },
  { minAmount: 100, maxAmount: 1000, feePercentage: 0.3 },
  { minAmount: 1000, maxAmount: 10000, feePercentage: 0.2 },
  { minAmount: 10000, maxAmount: Infinity, feePercentage: 0.1 },
] as const;

/**
 * Default role discounts
 */
export const DEFAULT_ROLE_DISCOUNTS: RoleDiscount[] = [
  { role: 'admin', discountMultiplier: 0 },
  { role: 'operator', discountMultiplier: 0.5 },
  { role: 'readonly', discountMultiplier: 0.8 },
  { role: 'user', discountMultiplier: 1 },
] as const;
