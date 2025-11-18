import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionRequest } from '../execution/types';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, FeeCalculationResult } from '@copil/database';
import { DynamicFeeService } from './dynamic-fee.service';

export interface SecurityValidationResult {
  valid: boolean;
  reason?: string;
  adjustedRequest?: Partial<TransactionRequest>;
  feeCalculation?: FeeCalculationResult;
}

@Injectable()
export class TransactionSecurityService {
  private readonly logger = new Logger(TransactionSecurityService.name);
  private readonly nonces = new Map<number, number>(); // userId -> nonce
  private emergencyPause = false; // Will be controlled by admin

  // Role-based permissions
  private readonly ROLE_PERMISSIONS = {
    admin: {
      canWithdraw: true,
      canSwap: true,
      canBridge: true,
      maxDailyLimit: BigInt('1000000000000000000000000'), // 1M ETH
    },
    operator: {
      canWithdraw: true,
      canSwap: true,
      canBridge: true,
      maxDailyLimit: BigInt('100000000000000000000000'), // 100K ETH
    },
    user: {
      canWithdraw: true,
      canSwap: true,
      canBridge: true,
      maxDailyLimit: BigInt('10000000000000000000000'), // 10K ETH
    },
    readonly: {
      canWithdraw: false,
      canSwap: false,
      canBridge: false,
      maxDailyLimit: BigInt('0'),
    },
  };

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dynamicFeeService: DynamicFeeService,
  ) {
    // Load default security parameters
  }

  async validateTransaction(
    request: TransactionRequest,
    userId: number,
    sessionKeyId: string,
    sourceIP?: string,
  ): Promise<SecurityValidationResult> {
    try {
      // 1. Emergency Pause Check
      if (this.emergencyPause) {
        return {
          valid: false,
          reason: 'System is under emergency pause - all transactions are blocked',
        };
      }

      // 2. User Role and Permission Validation
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return {
          valid: false,
          reason: `User ${userId} not found`,
        };
      }

      const userRole: UserRole = user.role;

      const rolePermissions = this.ROLE_PERMISSIONS[userRole];

      // 3. IP Whitelist Validation

      if (sourceIP && user.allowedIPs && user.allowedIPs.length > 0) {
        if (!user.allowedIPs.includes(sourceIP)) {
          this.logger.warn(`IP ${sourceIP} not whitelisted for user ${userId}`);
          return {
            valid: false,
            reason: `IP address ${sourceIP} is not whitelisted for this user`,
          };
        }
      }

      // 4. User Whitelist Validation
      if (!user.isWhitelisted) {
        return {
          valid: false,
          reason: 'User is not whitelisted for transactions',
        };
      }

      // 5. Role-based Action Validation
      const actionType = this.extractActionFromTransaction(request);
      if (!this.isActionAllowedForRole(actionType, userRole)) {
        return {
          valid: false,
          reason: `Action ${actionType} is not permitted for user role ${userRole}`,
        };
      }

      // 6. Deadline Validation
      if (request.deadline) {
        const currentTime = Math.floor(Date.now() / 1000);
        if (currentTime > request.deadline) {
          return {
            valid: false,
            reason: `Transaction deadline expired. Current: ${currentTime}, Deadline: ${request.deadline}`,
          };
        }
      }

      // 7. Nonce Validation (Replay Protection)
      if (request.nonce !== undefined) {
        const userNonce = this.nonces.get(userId) || 0;
        if (request.nonce <= userNonce) {
          return {
            valid: false,
            reason: `Invalid nonce. Expected: ${userNonce + 1}, Provided: ${request.nonce}`,
          };
        }
      }

      // 8. Amount Validation with Role Limits
      if (request.maxAmount && request.value) {
        const value = BigInt(request.value);
        const maxValue = BigInt(request.maxAmount);

        if (value > maxValue) {
          return {
            valid: false,
            reason: `Transaction amount exceeds maximum allowed. Amount: ${value.toString()}, Max: ${maxValue.toString()}`,
          };
        }
      }

      // 9. Role-based Daily Limit Validation
      if (request.value) {
        const value = BigInt(request.value);

        const roleLimit = rolePermissions.maxDailyLimit;

        if (value > roleLimit) {
          return {
            valid: false,

            reason: `Amount exceeds role daily limit. Amount: ${value.toString()}, Limit: ${roleLimit.toString()} for role ${userRole}`,
          };
        }
      }

      // 10. Gas Limit Validation
      if (request.gasLimit) {
        const gasLimit = BigInt(request.gasLimit);
        const maxGasLimit = BigInt(this.configService.get<string>('MAX_GAS_LIMIT', '1000000'));

        if (gasLimit > maxGasLimit) {
          return {
            valid: false,
            reason: `Gas limit exceeds maximum. Provided: ${gasLimit.toString()}, Max: ${maxGasLimit.toString()}`,
          };
        }
      }

      // 11. Priority Fee Validation (MEV Protection)
      if (request.priorityFee) {
        const priorityFee = BigInt(request.priorityFee);
        const maxPriorityFee = BigInt(
          this.configService.get<string>('MAX_PRIORITY_FEE', '1000000000000000000'),
        ); // 1 ETH

        if (priorityFee > maxPriorityFee) {
          return {
            valid: false,
            reason: `Priority fee exceeds maximum. Provided: ${priorityFee.toString()}, Max: ${maxPriorityFee.toString()}`,
          };
        }
      }

      // 12. User-specific Limits (override role limits if lower)
      const userLimits = await this.getUserLimits(userId);
      if (request.value && userLimits.dailyLimit) {
        const value = BigInt(request.value);
        if (value > userLimits.dailyLimit) {
          return {
            valid: false,
            reason: `Amount exceeds user daily limit. Amount: ${value.toString()}, Limit: ${userLimits.dailyLimit.toString()}`,
          };
        }
      }

      // 13. Fee Validation (Dynamic Fee Structure)
      const action = this.extractActionFromTransaction(request);
      if (['swap', 'bridge'].includes(action)) {
        const isFirstTransaction = await this.isFirstTransaction(userId, request);
        const chain = this.extractChainFromRequest(request);

        const feeCalculation = this.dynamicFeeService.calculateFee(
          BigInt(request.value || '0'),
          chain,
          userRole,
          isFirstTransaction,
        );

        // Validate fee is within acceptable limits
        if (feeCalculation.feePercentage > 0.5) {
          return {
            valid: false,
            reason: `Fee percentage exceeds maximum. Calculated: ${feeCalculation.feePercentage}%, Max: 0.5%`,
          };
        }

        // Add fee calculation to result for later use
        return {
          valid: true,
          feeCalculation,
        };
      }

      // 14. Update nonce if valid
      if (request.nonce !== undefined) {
        this.nonces.set(userId, request.nonce);
      }

      this.logger.log(
        `Transaction security validation passed for user ${userId} (role: ${userRole}), session key ${sessionKeyId}`,
      );
      return { valid: true };
    } catch (error) {
      this.logger.error(
        `Transaction security validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        valid: false,
        reason: 'Security validation encountered an error',
      };
    }
  }

  validateSwapSlippage(
    request: TransactionRequest,
    expectedAmountOut: string,
    actualAmountOut: string,
  ): SecurityValidationResult {
    if (!request.maxSlippagePercent) {
      return { valid: true }; // No slippage protection requested
    }

    const expected = BigInt(expectedAmountOut);
    const actual = BigInt(actualAmountOut);

    if (actual < expected) {
      const slippagePercent = Number(((expected - actual) * 10000n) / expected) / 100;
      const maxSlippage = request.maxSlippagePercent;

      if (slippagePercent > maxSlippage) {
        return {
          valid: false,
          reason: `Slippage too high. Actual: ${slippagePercent}%, Max allowed: ${maxSlippage}%`,
        };
      }
    }

    return { valid: true };
  }

  private extractActionFromTransaction(request: TransactionRequest): string {
    // Extract action type from transaction data
    // This is a simplified implementation - in production, you'd parse the actual function selector
    const data = request.data.toLowerCase();

    if (data.includes('swap') || data.includes('exactinputsingle')) {
      return 'swap';
    } else if (data.includes('bridge') || data.includes('transfercrosschain')) {
      return 'bridge';
    } else if (data.includes('transfer') || data.includes('transferfrom')) {
      return 'transfer';
    } else {
      return 'custom';
    }
  }

  private isActionAllowedForRole(action: string, role: UserRole): boolean {
    const rolePermissions = this.ROLE_PERMISSIONS[role];

    switch (action) {
      case 'swap':
        return rolePermissions.canSwap;
      case 'bridge':
        return rolePermissions.canBridge;
      case 'transfer':
        return rolePermissions.canWithdraw;
      default:
        return role === 'admin'; // Only admin can do custom actions
    }
  }

  /**
   * Check if this is the user's first transaction on the chain
   * Used for deployment cost calculation
   */
  private async isFirstTransaction(userId: number, request: TransactionRequest): Promise<boolean> {
    // In a real implementation, check transaction history
    // For now, assume first transaction if no wallet exists
    const chain = this.extractChainFromRequest(request);
    const userWallets = await this.userRepository.query(
      'SELECT COUNT(*) as count FROM "Wallet" WHERE "userId" = $1 AND "chain" = $2',
      [userId, chain],
    );

    return userWallets[0]?.count === 0;
  }

  /**
   * Extract chain from transaction request
   */
  private extractChainFromRequest(request: TransactionRequest): string {
    // In a real implementation, extract from request context or RPC URL
    // For now, default to ethereum
    return 'ethereum';
  }

  private async getUserLimits(userId: number): Promise<{ dailyLimit?: bigint }> {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });

      // Default limits for new users
      const defaultDailyLimit = BigInt(
        this.configService.get<string>('DEFAULT_DAILY_LIMIT', '10000000000000000000000'),
      ); // 10,000 ETH

      return {
        dailyLimit: user?.dailyLimit || defaultDailyLimit,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get user limits for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        dailyLimit: BigInt('1000000000000000000000'), // 1,000 ETH fallback
      };
    }
  }

  // Emergency Controls
  setEmergencyPause(paused: boolean): void {
    this.emergencyPause = paused;
    this.logger.warn(
      `Emergency pause ${paused ? 'ACTIVATED' : 'DEACTIVATED'} - All transactions ${paused ? 'blocked' : 'allowed'}`,
    );
  }

  isEmergencyPaused(): boolean {
    return this.emergencyPause;
  }

  // Reset user nonce (for recovery)
  resetUserNonce(userId: number): void {
    this.nonces.delete(userId);
    this.logger.warn(`Nonce reset for user ${userId}`);
  }

  // Get current nonce for user
  getUserNonce(userId: number): number {
    return this.nonces.get(userId) || 0;
  }
}
