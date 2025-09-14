import { z } from 'zod';
import { BaseDeFiTool } from './BaseTools';
import { DexProtocol } from '@copil/blockchain';

const DCAToolSchema = z.object({
  tokenFrom: z.string().describe('Symbol or address of the token to swap from'),
  tokenTo: z.string().describe('Symbol or address of the token to swap to'),
  totalBudget: z.number().positive().describe('Total budget for the DCA strategy'),
  frequency: z.union([
    z.enum(['daily', 'weekly', 'monthly']),
    z.number().positive()
  ]).describe('How often to execute (daily/weekly/monthly or custom hours)'),
  duration: z.number().positive().optional().describe('Duration in days (default: 30)'),
  protocol: z.enum(['dragonswap', 'symphony']).optional().describe('DEX protocol to use (default: dragonswap)'),
});

export class DCATool extends BaseDeFiTool {
  name = 'create_dca_order';
  description = 'Create a Dollar Cost Averaging (DCA) order that automatically buys tokens at regular intervals over time. This helps reduce the impact of volatility.';

  constructor(
    seiProvider: any,
    dexExecutor: any,
    orderEngine: any,
    tokenResolver: any
  ) {
    super(
      seiProvider,
      dexExecutor,
      orderEngine,
      tokenResolver,
      DCAToolSchema
    );
  }

  protected async executeTyped(input: z.infer<typeof DCAToolSchema>): Promise<string> {
    try {
      const { 
        tokenFrom, 
        tokenTo, 
        totalBudget, 
        frequency, 
        duration = 30,
        protocol = 'dragonswap' 
      } = input;

      // Resolve token addresses
      const tokenFromMatch = await this.tokenResolver.resolveToken(tokenFrom);
      const tokenToMatch = await this.tokenResolver.resolveToken(tokenTo);

      if (!tokenFromMatch || !tokenToMatch) {
        return JSON.stringify({
          success: false,
          error: 'Token not found',
          message: `Could not resolve tokens: ${!tokenFromMatch ? tokenFrom : ''} ${!tokenToMatch ? tokenTo : ''}`
        });
      }

      // Convert frequency to seconds
      const frequencyInSeconds = this.convertFrequencyToSeconds(frequency);
      
      // Calculate max executions based on duration and frequency
      const maxExecutions = Math.floor((duration * 24 * 3600) / frequencyInSeconds);
      
      if (maxExecutions === 0) {
        return JSON.stringify({
          success: false,
          error: 'Invalid parameters',
          message: 'Duration is too short for the given frequency'
        });
      }

      const totalBudgetInWei = this.parseTokenAmount(totalBudget, tokenFromMatch.decimals);
      const amountPerExecution = totalBudgetInWei / BigInt(maxExecutions);

      // Create DCA order
      const result = await this.dexExecutor.createDCAOrder({
        protocol: protocol as DexProtocol,
        tokenIn: tokenFromMatch.address,
        tokenOut: tokenToMatch.address,
        totalBudget: totalBudgetInWei,
        frequency: frequencyInSeconds,
        maxExecutions,
      });

      const formattedTotalBudget = this.formatTokenAmount(totalBudgetInWei, tokenFromMatch.decimals);
      const formattedAmountPerExecution = this.formatTokenAmount(amountPerExecution, tokenFromMatch.decimals);
      const frequencyDescription = this.formatFrequency(frequency);

      return JSON.stringify({
        success: true,
        message: `Successfully created DCA order: ${formattedTotalBudget} ${tokenFromMatch.symbol} → ${tokenToMatch.symbol} over ${duration} days`,
        data: {
          orderId: result.orderId,
          transactionHash: result.transactionHash,
          tokenFrom: {
            symbol: tokenFromMatch.symbol,
            totalBudget: formattedTotalBudget,
            amountPerExecution: formattedAmountPerExecution
          },
          tokenTo: {
            symbol: tokenToMatch.symbol
          },
          strategy: {
            frequency: frequencyDescription,
            duration: `${duration} days`,
            maxExecutions,
            protocol
          },
          status: 'active',
          estimatedCompletion: new Date(Date.now() + duration * 24 * 3600 * 1000).toISOString()
        }
      });

    } catch (error) {
      const errorResult = await this.handleError(error, 'create DCA order');
      return JSON.stringify(errorResult);
    }
  }

  private convertFrequencyToSeconds(frequency: string | number): number {
    if (typeof frequency === 'number') {
      return frequency * 3600; // hours to seconds
    }

    switch (frequency) {
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

  private formatFrequency(frequency: string | number): string {
    if (typeof frequency === 'number') {
      return `every ${frequency} hours`;
    }

    return frequency;
  }
}

export function createDCATool(
  seiProvider: any,
  dexExecutor: any,
  orderEngine: any,
  tokenResolver: any
): DCATool {
  return new DCATool(seiProvider, dexExecutor, orderEngine, tokenResolver);
}