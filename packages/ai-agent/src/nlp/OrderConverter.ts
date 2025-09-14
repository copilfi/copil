import { Intent, DeFiAction, SwapIntent, LimitOrderIntent, DCAIntent } from '../types';
import { DexProtocol, DexSwapOrderParams, ConditionalSwapParams } from '@copil/blockchain';
import { OrderType } from '@copil/blockchain';
import { TokenResolver } from '../utils/TokenResolver';
import { Address } from 'viem';

export interface ConversionResult {
  success: boolean;
  data?: any;
  error?: string;
  warnings?: string[];
}

export class OrderConverter {
  constructor(private tokenResolver: TokenResolver) {}

  /**
   * Convert a natural language intent into executable order parameters
   */
  async convertIntentToOrder(intent: Intent): Promise<ConversionResult> {
    try {
      const warnings: string[] = [];

      switch (intent.action) {
        case DeFiAction.SWAP:
          return await this.convertSwapIntent(intent.entities as SwapIntent, warnings);
        
        case DeFiAction.LIMIT_ORDER:
          return await this.convertLimitOrderIntent(intent.entities as LimitOrderIntent, warnings);
        
        case DeFiAction.DCA:
          return await this.convertDCAIntent(intent.entities as DCAIntent, warnings);
        
        default:
          return {
            success: false,
            error: `Unsupported action: ${intent.action}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown conversion error'
      };
    }
  }

  private async convertSwapIntent(
    swapIntent: SwapIntent, 
    warnings: string[]
  ): Promise<ConversionResult> {
    // Validate required fields
    if (!swapIntent.tokenFrom || !swapIntent.tokenTo || !swapIntent.amount) {
      return {
        success: false,
        error: 'Missing required fields: tokenFrom, tokenTo, or amount'
      };
    }

    // Resolve tokens
    const tokenFromMatch = await this.tokenResolver.resolveToken(swapIntent.tokenFrom);
    const tokenToMatch = await this.tokenResolver.resolveToken(swapIntent.tokenTo);

    if (!tokenFromMatch || !tokenToMatch) {
      return {
        success: false,
        error: `Could not resolve tokens: ${!tokenFromMatch ? swapIntent.tokenFrom : ''} ${!tokenToMatch ? swapIntent.tokenTo : ''}`
      };
    }

    // Add confidence warnings
    if (tokenFromMatch.confidence < 0.8) {
      warnings.push(`Low confidence match for token '${swapIntent.tokenFrom}' → '${tokenFromMatch.symbol}'`);
    }
    if (tokenToMatch.confidence < 0.8) {
      warnings.push(`Low confidence match for token '${swapIntent.tokenTo}' → '${tokenToMatch.symbol}'`);
    }

    // Validate amount
    if (swapIntent.amount <= 0) {
      return {
        success: false,
        error: 'Amount must be greater than zero'
      };
    }

    // Check for potentially large amounts
    if (swapIntent.amount > 1000) {
      warnings.push('Large amount detected - please double-check the transaction');
    }

    // Validate slippage
    let slippage = swapIntent.slippage || 0.5; // Default 0.5%
    if (slippage > 50) {
      return {
        success: false,
        error: 'Slippage tolerance cannot exceed 50%'
      };
    }
    if (slippage > 5) {
      warnings.push(`High slippage tolerance (${slippage}%) - you may experience significant price impact`);
    }

    // Convert to wei
    const amountInWei = this.parseTokenAmount(swapIntent.amount, tokenFromMatch.decimals);

    // Select protocol (default to DragonSwap)
    const protocol = DexProtocol.DRAGONSWAP;

    const swapParams: DexSwapOrderParams = {
      protocol,
      tokenIn: tokenFromMatch.address,
      tokenOut: tokenToMatch.address,
      amountIn: amountInWei,
      slippageTolerance: slippage / 100 // Convert percentage to decimal
    };

    return {
      success: true,
      data: swapParams,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  private async convertLimitOrderIntent(
    limitIntent: LimitOrderIntent, 
    warnings: string[]
  ): Promise<ConversionResult> {
    // Validate required fields
    if (!limitIntent.tokenFrom || !limitIntent.tokenTo || !limitIntent.amount || !limitIntent.targetPrice) {
      return {
        success: false,
        error: 'Missing required fields: tokenFrom, tokenTo, amount, or targetPrice'
      };
    }

    // Resolve tokens
    const tokenFromMatch = await this.tokenResolver.resolveToken(limitIntent.tokenFrom);
    const tokenToMatch = await this.tokenResolver.resolveToken(limitIntent.tokenTo);

    if (!tokenFromMatch || !tokenToMatch) {
      return {
        success: false,
        error: `Could not resolve tokens: ${!tokenFromMatch ? limitIntent.tokenFrom : ''} ${!tokenToMatch ? limitIntent.tokenTo : ''}`
      };
    }

    // Validate amounts
    if (limitIntent.amount <= 0 || limitIntent.targetPrice <= 0) {
      return {
        success: false,
        error: 'Amount and target price must be greater than zero'
      };
    }

    // Convert to appropriate order type
    const orderType = limitIntent.orderType === 'buy' ? OrderType.LIMIT_BUY : OrderType.LIMIT_SELL;

    // Convert amounts
    const amountInWei = this.parseTokenAmount(limitIntent.amount, tokenFromMatch.decimals);
    const targetPriceInWei = this.parseTokenAmount(limitIntent.targetPrice, tokenToMatch.decimals);

    // Calculate deadline (default 24 hours)
    const deadlineHours = limitIntent.deadline || 24;
    const deadlineTimestamp = Math.floor(Date.now() / 1000) + (deadlineHours * 3600);

    if (deadlineHours > 720) { // More than 30 days
      warnings.push('Long deadline (>30 days) - consider shorter timeframes for better execution');
    }

    const conditionalParams: ConditionalSwapParams = {
      protocol: DexProtocol.DRAGONSWAP,
      tokenIn: tokenFromMatch.address,
      tokenOut: tokenToMatch.address,
      amountIn: amountInWei,
      orderType,
      priceTarget: targetPriceInWei,
      timeDeadline: deadlineTimestamp
    };

    return {
      success: true,
      data: conditionalParams,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  private async convertDCAIntent(
    dcaIntent: DCAIntent, 
    warnings: string[]
  ): Promise<ConversionResult> {
    // Validate required fields
    if (!dcaIntent.tokenFrom || !dcaIntent.tokenTo || !dcaIntent.totalBudget || !dcaIntent.frequency) {
      return {
        success: false,
        error: 'Missing required fields: tokenFrom, tokenTo, totalBudget, or frequency'
      };
    }

    // Resolve tokens
    const tokenFromMatch = await this.tokenResolver.resolveToken(dcaIntent.tokenFrom);
    const tokenToMatch = await this.tokenResolver.resolveToken(dcaIntent.tokenTo);

    if (!tokenFromMatch || !tokenToMatch) {
      return {
        success: false,
        error: `Could not resolve tokens: ${!tokenFromMatch ? dcaIntent.tokenFrom : ''} ${!tokenToMatch ? dcaIntent.tokenTo : ''}`
      };
    }

    // Validate budget
    if (dcaIntent.totalBudget <= 0) {
      return {
        success: false,
        error: 'Total budget must be greater than zero'
      };
    }

    // Convert frequency to seconds
    const frequencyInSeconds = this.convertFrequencyToSeconds(dcaIntent.frequency);
    
    // Validate frequency
    if (frequencyInSeconds < 3600) { // Less than 1 hour
      return {
        success: false,
        error: 'Frequency must be at least 1 hour'
      };
    }

    if (frequencyInSeconds < 86400) { // Less than 1 day
      warnings.push('High frequency DCA (< 1 day) may incur significant gas costs');
    }

    // Calculate duration and max executions
    const durationInDays = dcaIntent.duration || 30; // Default 30 days
    const maxExecutions = Math.floor((durationInDays * 24 * 3600) / frequencyInSeconds);

    if (maxExecutions < 2) {
      return {
        success: false,
        error: 'Duration too short for the given frequency - would result in less than 2 executions'
      };
    }

    if (maxExecutions > 100) {
      warnings.push('Very high number of executions (>100) - consider longer frequency intervals');
    }

    // Check minimum amount per execution
    const amountPerExecution = dcaIntent.totalBudget / maxExecutions;
    if (amountPerExecution < 1) {
      warnings.push('Very small amount per execution - may not be cost-effective due to gas fees');
    }

    const totalBudgetInWei = this.parseTokenAmount(dcaIntent.totalBudget, tokenFromMatch.decimals);

    const dcaParams = {
      protocol: DexProtocol.DRAGONSWAP as DexProtocol,
      tokenIn: tokenFromMatch.address,
      tokenOut: tokenToMatch.address,
      totalBudget: totalBudgetInWei,
      frequency: frequencyInSeconds,
      maxExecutions
    };

    return {
      success: true,
      data: dcaParams,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  private convertFrequencyToSeconds(frequency: string | number): number {
    if (typeof frequency === 'number') {
      return frequency * 3600; // hours to seconds
    }

    switch (frequency.toLowerCase()) {
      case 'daily':
        return 24 * 3600; // 24 hours
      case 'weekly':
        return 7 * 24 * 3600; // 7 days
      case 'monthly':
        return 30 * 24 * 3600; // 30 days
      default:
        throw new Error(`Invalid frequency: ${frequency}`);
    }
  }

  private parseTokenAmount(amount: number, decimals: number = 18): bigint {
    const amountStr = amount.toString();
    const [whole, fractional = ''] = amountStr.split('.');
    
    const wholeBigInt = BigInt(whole || '0');
    const fractionalPadded = fractional.padEnd(decimals, '0').slice(0, decimals);
    const fractionalBigInt = BigInt(fractionalPadded || '0');
    
    return wholeBigInt * (10n ** BigInt(decimals)) + fractionalBigInt;
  }

  /**
   * Validate if the conversion result makes sense
   */
  validateConversion(result: ConversionResult): string[] {
    const issues: string[] = [];

    if (!result.success) {
      issues.push(result.error || 'Conversion failed');
      return issues;
    }

    // Add common validation logic here
    if (result.warnings) {
      issues.push(...result.warnings);
    }

    return issues;
  }

  /**
   * Generate a human-readable summary of the converted order
   */
  generateOrderSummary(result: ConversionResult, intent: Intent): string {
    if (!result.success || !result.data) {
      return `Failed to process order: ${result.error}`;
    }

    switch (intent.action) {
      case DeFiAction.SWAP: {
        const params = result.data as DexSwapOrderParams;
        return `Swap order: ${this.formatAmount(params.amountIn)} → ${params.tokenOut} via ${params.protocol}`;
      }

      case DeFiAction.LIMIT_ORDER: {
        const params = result.data as ConditionalSwapParams;
        const orderTypeStr = params.orderType === OrderType.LIMIT_BUY ? 'Buy' : 'Sell';
        return `${orderTypeStr} limit order: ${this.formatAmount(params.amountIn)} at target price ${this.formatAmount(params.priceTarget || 0n)}`;
      }

      case DeFiAction.DCA: {
        const params = result.data;
        return `DCA order: ${this.formatAmount(params.totalBudget)} over ${params.maxExecutions} executions`;
      }

      default:
        return 'Order processed';
    }
  }

  private formatAmount(amount: bigint, decimals: number = 18): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const remainder = amount % divisor;
    
    if (remainder === 0n) {
      return whole.toString();
    }
    
    const fractional = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fractional ? `${whole}.${fractional}` : whole.toString();
  }
}