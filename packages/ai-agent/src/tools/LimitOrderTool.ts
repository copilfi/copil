import { z } from 'zod';
import { BaseDeFiTool } from './BaseTools';
import { OrderType } from '@copil/blockchain';
import { DexProtocol } from '@copil/blockchain';

const LimitOrderToolSchema = z.object({
  tokenFrom: z.string().describe('Symbol or address of the token to swap from'),
  tokenTo: z.string().describe('Symbol or address of the token to swap to'),
  amount: z.number().positive().describe('Amount of tokens to swap'),
  targetPrice: z.number().positive().describe('Target price for the limit order'),
  orderType: z.enum(['buy', 'sell']).describe('Whether this is a buy or sell limit order'),
  deadline: z.number().optional().describe('Order deadline in hours (default: 24)'),
  protocol: z.enum(['dragonswap', 'symphony']).optional().describe('DEX protocol to use (default: dragonswap)'),
});

export class LimitOrderTool extends BaseDeFiTool {
  name = 'create_limit_order';
  description = 'Create a limit order that will execute when the target price is reached. The order will be automatically executed by the system when conditions are met.';

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
      LimitOrderToolSchema
    );
  }

  protected async executeTyped(input: z.infer<typeof LimitOrderToolSchema>): Promise<string> {
    try {
      const { 
        tokenFrom, 
        tokenTo, 
        amount, 
        targetPrice, 
        orderType, 
        deadline = 24,
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

      const amountInWei = this.parseTokenAmount(amount, tokenFromMatch.decimals);
      const targetPriceInWei = this.parseTokenAmount(targetPrice, tokenToMatch.decimals);
      
      // Calculate deadline timestamp
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + (deadline * 3600);

      // Determine order type for the engine
      const engineOrderType = orderType === 'buy' ? OrderType.LIMIT_BUY : OrderType.LIMIT_SELL;

      // Create conditional swap order
      const result = await this.dexExecutor.createConditionalSwapOrder({
        protocol: protocol as DexProtocol,
        tokenIn: tokenFromMatch.address,
        tokenOut: tokenToMatch.address,
        amountIn: amountInWei,
        orderType: engineOrderType,
        priceTarget: targetPriceInWei,
        timeDeadline: deadlineTimestamp
      });

      const formattedAmount = this.formatTokenAmount(amountInWei, tokenFromMatch.decimals);
      const formattedTargetPrice = this.formatTokenAmount(targetPriceInWei, tokenToMatch.decimals);

      return JSON.stringify({
        success: true,
        message: `Successfully created ${orderType} limit order: ${formattedAmount} ${tokenFromMatch.symbol} → ${tokenToMatch.symbol} at target price ${formattedTargetPrice}`,
        data: {
          orderId: result.orderId,
          transactionHash: result.transactionHash,
          orderType: orderType,
          tokenFrom: {
            symbol: tokenFromMatch.symbol,
            amount: formattedAmount
          },
          tokenTo: {
            symbol: tokenToMatch.symbol,
            targetPrice: formattedTargetPrice
          },
          protocol: protocol,
          deadline: new Date(deadlineTimestamp * 1000).toISOString(),
          status: 'active'
        }
      });

    } catch (error) {
      const errorResult = await this.handleError(error, 'create limit order');
      return JSON.stringify(errorResult);
    }
  }
}

export function createLimitOrderTool(
  seiProvider: any,
  dexExecutor: any,
  orderEngine: any,
  tokenResolver: any
): LimitOrderTool {
  return new LimitOrderTool(seiProvider, dexExecutor, orderEngine, tokenResolver);
}