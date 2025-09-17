import { z } from 'zod';
import { BaseDeFiTool } from './BaseTools';
import { ToolResult, DeFiAction } from '../types';
import { DexProtocol } from '@copil/blockchain';

const SwapToolSchema = z.object({
  tokenFrom: z.string().describe('Symbol or address of the token to swap from (e.g., "SEI", "WSEI", "USDC")'),
  tokenTo: z.string().describe('Symbol or address of the token to swap to (e.g., "SEI", "WSEI", "USDC")'),
  amount: z.number().positive().describe('Amount of tokens to swap'),
  slippage: z.number().min(0).max(50).optional().nullable().describe('Maximum slippage tolerance in percentage (default: 0.5)'),
  protocol: z.enum(['dragonswap', 'symphony']).optional().nullable().describe('DEX protocol to use (default: best quote)'),
});

export class SwapTool extends BaseDeFiTool {
  name = 'swap_tokens';
  description = 'Swap one token for another on Sei Network. Automatically finds the best price across DragonSwap and Symphony.';

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
      SwapToolSchema
    );
  }

  protected async executeTyped(input: z.infer<typeof SwapToolSchema>): Promise<string> {
    try {
      const { tokenFrom, tokenTo, amount, slippage = 0.5, protocol } = input;

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

      const amountInWei = this.parseTokenAmount(amount, tokenFromMatch.decimals);

      let selectedProtocol: DexProtocol;
      let bestQuote: any;

      if (protocol) {
        selectedProtocol = protocol as DexProtocol;
      } else {
        // Find best quote across all DEXes
        bestQuote = await this.dexExecutor.getBestQuote({
          tokenIn: tokenFromMatch.address,
          tokenOut: tokenToMatch.address,
          amountIn: amountInWei
        });
        selectedProtocol = bestQuote.protocol;
      }

      // Calculate minimum output with slippage
      const quote = bestQuote || await this.getBestQuoteForProtocol(
        selectedProtocol,
        tokenFromMatch.address,
        tokenToMatch.address,
        amountInWei
      );

      const amountOutMin = quote.amountOut * BigInt(Math.floor((100 - slippage) * 10)) / 1000n;

      // Execute swap
      const result = await this.dexExecutor.executeSwap({
        protocol: selectedProtocol,
        tokenIn: tokenFromMatch.address,
        tokenOut: tokenToMatch.address,
        amountIn: amountInWei,
        amountOutMin,
        slippageTolerance: slippage / 100
      });

      const outputAmount = this.formatTokenAmount(result.amountOut, tokenToMatch.decimals);

      return JSON.stringify({
        success: true,
        message: `Successfully swapped ${amount} ${tokenFromMatch.symbol} for ${outputAmount} ${tokenToMatch.symbol} via ${selectedProtocol}`,
        data: {
          transactionHash: result.hash,
          amountIn: amount,
          amountOut: outputAmount,
          protocol: selectedProtocol,
          gasUsed: result.gasUsed.toString(),
          slippage: slippage
        }
      });

    } catch (error) {
      const errorResult = await this.handleError(error, 'swap tokens');
      return JSON.stringify(errorResult);
    }
  }

  private async getBestQuoteForProtocol(
    protocol: DexProtocol,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ) {
    try {
      // Get the actual quote from the specified protocol
      const quote = await this.dexExecutor.getQuote({
        protocol,
        tokenIn: tokenIn as `0x${string}`,
        tokenOut: tokenOut as `0x${string}`,
        amountIn
      });
      
      return {
        amountOut: quote.amountOut,
        priceImpact: quote.priceImpact,
        gasEstimate: quote.gasEstimate
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to get quote from ${protocol}:`, errorMessage);
      
      // Fallback: estimate based on liquidity assumptions
      const estimatedOutput = amountIn * 997n / 1000n; // 0.3% fee assumption
      return {
        amountOut: estimatedOutput,
        priceImpact: 0.003, // 0.3% estimated impact
        gasEstimate: 200000n
      };
    }
  }
}

// Utility function to create swap tool
export function createSwapTool(
  seiProvider: any,
  dexExecutor: any,
  orderEngine: any,
  tokenResolver: any
): SwapTool {
  return new SwapTool(seiProvider, dexExecutor, orderEngine, tokenResolver);
}