import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, ILike } from 'typeorm';
import { TransactionLog, User, Wallet } from '@copil/database';
import { PortfolioService } from '../portfolio/portfolio.service';

/**
 * Risk management service to enforce trading limits and protect users
 */
@Injectable()
export class RiskManager {
  private readonly logger = new Logger(RiskManager.name);

  // Risk parameters - can be made configurable
  private readonly MAX_LEVERAGE_SMALL_ACCOUNT = 10;  // Max 10x for accounts <$10k
  private readonly MAX_LEVERAGE_MEDIUM_ACCOUNT = 20; // Max 20x for accounts <$100k
  private readonly MAX_LEVERAGE_LARGE_ACCOUNT = 30;  // Max 30x for accounts >$100k
  private readonly MAX_LEVERAGE_ABSOLUTE = 50;       // Never exceed 50x

  private readonly MAX_POSITION_PERCENT = 0.3;        // Max 30% of portfolio in single position
  private readonly MAX_DAILY_TRADES = 50;             // Max trades per day
  private readonly MAX_HOURLY_TRADES = 10;            // Max trades per hour
  private readonly MAX_SLIPPAGE_PERCENT = 5;          // Max 5% slippage
  private readonly MIN_MARGIN_BUFFER = 1.5;           // 50% buffer from liquidation

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    private readonly portfolioService: PortfolioService,
  ) {}

  /**
   * Validate and adjust leverage based on account size and risk profile
   */
  async validateLeverage(userId: number, requestedLeverage: number): Promise<{
    allowed: boolean;
    adjustedLeverage: number;
    reason?: string;
  }> {
    // Get user's total portfolio value
    const portfolioValue = await this.getUserPortfolioValue(userId);

    // Determine max allowed leverage based on account size
    let maxLeverage: number;
    if (portfolioValue < 10000) {
      maxLeverage = this.MAX_LEVERAGE_SMALL_ACCOUNT;
    } else if (portfolioValue < 100000) {
      maxLeverage = this.MAX_LEVERAGE_MEDIUM_ACCOUNT;
    } else {
      maxLeverage = this.MAX_LEVERAGE_LARGE_ACCOUNT;
    }

    // Never exceed absolute maximum
    maxLeverage = Math.min(maxLeverage, this.MAX_LEVERAGE_ABSOLUTE);

    // Check user's recent liquidations (risk score)
    const recentLiquidations = await this.getRecentLiquidations(userId, 30); // Last 30 days
    if (recentLiquidations > 0) {
      // Reduce max leverage if user has recent liquidations
      maxLeverage = Math.max(5, maxLeverage * 0.5);
      this.logger.warn(`User ${userId} has ${recentLiquidations} recent liquidations. Reducing max leverage to ${maxLeverage}x`);
    }

    // Adjust leverage if exceeds maximum
    const adjustedLeverage = Math.min(requestedLeverage, maxLeverage);

    if (adjustedLeverage < requestedLeverage) {
      return {
        allowed: false,
        adjustedLeverage,
        reason: `Maximum leverage for your account size ($${portfolioValue.toFixed(2)}) is ${maxLeverage}x. Adjusted to ${adjustedLeverage}x.`
      };
    }

    return {
      allowed: true,
      adjustedLeverage,
    };
  }

  /**
   * Validate position size relative to portfolio
   */
  async validatePositionSize(userId: number, positionSizeUsd: number, leverage: number): Promise<{
    allowed: boolean;
    maxPositionSize?: number;
    reason?: string;
  }> {
    const portfolioValue = await this.getUserPortfolioValue(userId);

    // Calculate margin required
    const marginRequired = positionSizeUsd / leverage;

    // Check if user has enough margin
    if (marginRequired > portfolioValue) {
      return {
        allowed: false,
        maxPositionSize: portfolioValue * leverage,
        reason: `Insufficient margin. You need $${marginRequired.toFixed(2)} but only have $${portfolioValue.toFixed(2)} available.`
      };
    }

    // Check position size limit (% of portfolio)
    const maxPositionSize = portfolioValue * this.MAX_POSITION_PERCENT * leverage;
    if (positionSizeUsd > maxPositionSize) {
      return {
        allowed: false,
        maxPositionSize,
        reason: `Position size exceeds ${(this.MAX_POSITION_PERCENT * 100)}% of portfolio limit. Maximum: $${maxPositionSize.toFixed(2)}`
      };
    }

    // Check liquidation buffer
    const liquidationPrice = this.calculateLiquidationPrice(positionSizeUsd, marginRequired, leverage);
    if (liquidationPrice < this.MIN_MARGIN_BUFFER) {
      return {
        allowed: false,
        reason: `Position too risky. Insufficient buffer from liquidation price.`
      };
    }

    return {
      allowed: true,
    };
  }

  /**
   * Check trading frequency limits
   */
  async checkTradingFrequency(userId: number): Promise<{
    allowed: boolean;
    reason?: string;
    dailyCount?: number;
    hourlyCount?: number;
  }> {
    const now = new Date();

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const hourlyTrades = await this.transactionLogRepository.count({
      where: {
        userId,
        status: 'success',
        createdAt: MoreThan(oneHourAgo),
      },
    });

    if (hourlyTrades >= this.MAX_HOURLY_TRADES) {
      return {
        allowed: false,
        reason: `Hourly trading limit reached (${this.MAX_HOURLY_TRADES} trades per hour)`,
        hourlyCount: hourlyTrades,
      };
    }

    // Check daily limit
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dailyTrades = await this.transactionLogRepository.count({
      where: {
        userId,
        status: 'success',
        createdAt: MoreThan(oneDayAgo),
      },
    });

    if (dailyTrades >= this.MAX_DAILY_TRADES) {
      return {
        allowed: false,
        reason: `Daily trading limit reached (${this.MAX_DAILY_TRADES} trades per day)`,
        dailyCount: dailyTrades,
      };
    }

    return {
      allowed: true,
      dailyCount: dailyTrades,
      hourlyCount: hourlyTrades,
    };
  }

  /**
   * Validate slippage tolerance
   */
  validateSlippage(requestedSlippage?: number): {
    allowed: boolean;
    adjustedSlippage: number;
    reason?: string;
  } {
    // Default slippage if not provided
    const slippage = requestedSlippage ?? 1; // 1% default

    if (slippage > this.MAX_SLIPPAGE_PERCENT) {
      return {
        allowed: false,
        adjustedSlippage: this.MAX_SLIPPAGE_PERCENT,
        reason: `Slippage too high. Maximum allowed: ${this.MAX_SLIPPAGE_PERCENT}%. Adjusted to ${this.MAX_SLIPPAGE_PERCENT}%.`
      };
    }

    if (slippage < 0.1) {
      return {
        allowed: false,
        adjustedSlippage: 0.1,
        reason: `Slippage too low. Minimum: 0.1%. Adjusted to 0.1%.`
      };
    }

    return {
      allowed: true,
      adjustedSlippage: slippage,
    };
  }

  /**
   * Comprehensive risk check for a trade
   */
  async validateTrade(userId: number, intent: any): Promise<{
    allowed: boolean;
    adjustedIntent?: any;
    reasons: string[];
  }> {
    const warnings: string[] = [];
    let adjustedIntent = { ...intent };

    const frequencyCheck = await this.checkTradingFrequency(userId);
    if (!frequencyCheck.allowed) {
      return {
        allowed: false,
        reasons: [frequencyCheck.reason ?? 'Trading frequency limit reached'],
      };
    }

    if (intent.type === 'open_position') {
      const requestedLeverage = Number(intent.leverage ?? 1);
      const leverageCheck = await this.validateLeverage(userId, requestedLeverage);
      if (!leverageCheck.allowed) {
        if (typeof leverageCheck.adjustedLeverage === 'number') {
          adjustedIntent.leverage = leverageCheck.adjustedLeverage;
          warnings.push(leverageCheck.reason ?? 'Leverage adjusted based on account risk.');
        } else {
          return {
            allowed: false,
            reasons: [leverageCheck.reason ?? 'Leverage exceeds allowed limits.'],
          };
        }
      }

      const leverage = Number(adjustedIntent.leverage ?? requestedLeverage ?? 1);
      const positionSize = Number(intent.size ?? intent.positionSize ?? 0);
      const positionCheck = await this.validatePositionSize(userId, positionSize, leverage);
      if (!positionCheck.allowed) {
        if (positionCheck.maxPositionSize) {
          adjustedIntent.size = positionCheck.maxPositionSize.toString();
          warnings.push(positionCheck.reason ?? 'Position size adjusted to fit portfolio constraints.');
        } else {
          return {
            allowed: false,
            reasons: [positionCheck.reason ?? 'Position exceeds allowed risk limits.'],
          };
        }
      }

      const slippageCheck = this.validateSlippage(Number(intent.slippage ?? 0));
      if (!slippageCheck.allowed) {
        adjustedIntent.slippage = slippageCheck.adjustedSlippage;
        warnings.push(slippageCheck.reason ?? 'Slippage adjusted to safe range.');
      }
    }

    if (intent.type === 'swap' || intent.type === 'bridge') {
      const swapAmount = Number(intent.fromAmount ?? 0);
      const portfolioValue = await this.getUserPortfolioValue(userId);

      if (portfolioValue > 0 && swapAmount > portfolioValue * 0.5) {
        warnings.push('Swap amount exceeds 50% of portfolio value.');
      }

      const slippageBps = Number(intent.slippageBps ?? 100);
      const slippagePercent = slippageBps / 100;
      const slippageCheck = this.validateSlippage(slippagePercent);
      if (!slippageCheck.allowed) {
        adjustedIntent.slippageBps = Math.round(slippageCheck.adjustedSlippage * 100);
        warnings.push(slippageCheck.reason ?? 'Slippage adjusted to safe range.');
      }
    }

    return {
      allowed: true,
      adjustedIntent,
      reasons: warnings,
    };
  }

  /**
   * Get user's total portfolio value in USD
   */
  private async getUserPortfolioValue(userId: number): Promise<number> {
    try {
      const portfolio = await this.portfolioService.getPortfolioForUser(userId) as any[];
      return portfolio.reduce((total, asset) => total + parseFloat(asset.amountUsd || '0'), 0);
    } catch (error) {
      this.logger.error(`Failed to get portfolio value for user ${userId}: ${error}`);
      return 0;
    }
  }

  /**
   * Get count of recent liquidations
   */
  private async getRecentLiquidations(userId: number, days: number): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.transactionLogRepository.count({
      where: {
        userId,
        createdAt: MoreThan(since),
        description: ILike('%liquidat%'),
      },
    });
  }

  /**
   * Calculate liquidation price for a position
   */
  private calculateLiquidationPrice(positionSize: number, margin: number, leverage: number): number {
    // Simplified calculation - in reality this depends on the exchange
    // Liquidation occurs when losses equal initial margin
    // Price move % = 100 / leverage
    const liquidationPercent = 100 / leverage;
    return liquidationPercent;
  }

  /**
   * Enforce session key spend limits for the transaction
   */
  async enforceSessionKeyLimits(sessionKeyId: number, intent: any): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    // This would check the session key permissions against the intent
    // Implementation would depend on session key permission structure

    // For now, return allowed
    return { allowed: true };
  }
}
