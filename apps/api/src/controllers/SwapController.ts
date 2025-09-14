import { Request, Response } from 'express';
import { DexExecutor } from '@copil/blockchain';
import { BlockchainLogger } from '@copil/blockchain';
import { TokenResolver } from '@copil/ai-agent/src/utils/TokenResolver';
import { z } from 'zod';

const logger = BlockchainLogger.getInstance();

// Request validation schemas
const SwapQuoteSchema = z.object({
  tokenIn: z.string().min(1, 'Input token is required'),
  tokenOut: z.string().min(1, 'Output token is required'),
  amountIn: z.number().positive('Amount must be positive'),
  slippage: z.number().min(0).max(50).optional(),
  protocol: z.enum(['dragonswap', 'symphony']).optional()
});

const ExecuteSwapSchema = z.object({
  tokenIn: z.string().min(1, 'Input token is required'),
  tokenOut: z.string().min(1, 'Output token is required'),
  amountIn: z.number().positive('Amount must be positive'),
  amountOutMin: z.number().positive().optional(),
  slippage: z.number().min(0).max(50).optional(),
  protocol: z.enum(['dragonswap', 'symphony']).optional(),
  recipient: z.string().optional()
});

export class SwapController {
  private dexExecutor: DexExecutor;
  private tokenResolver: TokenResolver;

  constructor(dexExecutor: DexExecutor) {
    this.dexExecutor = dexExecutor;
    this.tokenResolver = new TokenResolver();
  }

  /**
   * Get real swap quote from DEX aggregator
   */
  getSwapQuote = async (req: Request, res: Response) => {
    try {
      const validatedData = SwapQuoteSchema.parse(req.body);

      // Resolve token addresses
      const tokenInMatch = await this.tokenResolver.resolveToken(validatedData.tokenIn);
      const tokenOutMatch = await this.tokenResolver.resolveToken(validatedData.tokenOut);

      if (!tokenInMatch || !tokenOutMatch) {
        return res.status(400).json({
          success: false,
          error: 'Token not found',
          message: `Could not resolve tokens: ${!tokenInMatch ? validatedData.tokenIn : ''} ${!tokenOutMatch ? validatedData.tokenOut : ''}`
        });
      }

      // Convert amount to wei
      const amountInWei = BigInt(Math.floor(validatedData.amountIn * Math.pow(10, tokenInMatch.decimals)));

      let quote;
      
      if (validatedData.protocol) {
        // Get quote from specific protocol
        quote = await this.dexExecutor.getQuote({
          protocol: validatedData.protocol as any,
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
      } else {
        // Get best quote across all protocols
        const bestQuote = await this.dexExecutor.getBestQuote({
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
        
        quote = {
          amountOut: bestQuote.amountOut,
          priceImpact: bestQuote.priceImpact,
          gasEstimate: bestQuote.gasEstimate
        };
        
        // Add protocol info to response
        quote.protocol = bestQuote.protocol;
      }

      // Convert output amount to human readable
      const amountOutFormatted = Number(quote.amountOut) / Math.pow(10, tokenOutMatch.decimals);

      res.json({
        success: true,
        data: {
          inputToken: {
            address: tokenInMatch.address,
            symbol: tokenInMatch.symbol,
            name: tokenInMatch.name,
            decimals: tokenInMatch.decimals
          },
          outputToken: {
            address: tokenOutMatch.address,
            symbol: tokenOutMatch.symbol,
            name: tokenOutMatch.name,
            decimals: tokenOutMatch.decimals
          },
          inputAmount: validatedData.amountIn,
          outputAmount: amountOutFormatted,
          rate: amountOutFormatted / validatedData.amountIn,
          priceImpact: quote.priceImpact,
          gasEstimate: quote.gasEstimate.toString(),
          protocol: quote.protocol || validatedData.protocol,
          route: [tokenInMatch.address, tokenOutMatch.address], // Simplified route
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to get swap quote', error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get swap quote'
      });
    }
  };

  /**
   * Execute real swap transaction
   */
  executeSwap = async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const validatedData = ExecuteSwapSchema.parse(req.body);

      // Resolve token addresses
      const tokenInMatch = await this.tokenResolver.resolveToken(validatedData.tokenIn);
      const tokenOutMatch = await this.tokenResolver.resolveToken(validatedData.tokenOut);

      if (!tokenInMatch || !tokenOutMatch) {
        return res.status(400).json({
          success: false,
          error: 'Token not found',
          message: `Could not resolve tokens: ${!tokenInMatch ? validatedData.tokenIn : ''} ${!tokenOutMatch ? validatedData.tokenOut : ''}`
        });
      }

      // Convert amounts to wei
      const amountInWei = BigInt(Math.floor(validatedData.amountIn * Math.pow(10, tokenInMatch.decimals)));
      const amountOutMinWei = validatedData.amountOutMin 
        ? BigInt(Math.floor(validatedData.amountOutMin * Math.pow(10, tokenOutMatch.decimals)))
        : undefined;

      // Get best protocol if not specified
      let protocol = validatedData.protocol;
      if (!protocol) {
        const bestQuote = await this.dexExecutor.getBestQuote({
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
        protocol = bestQuote.protocol;
      }

      // Calculate slippage protection
      let finalAmountOutMin = amountOutMinWei;
      if (!finalAmountOutMin && validatedData.slippage) {
        const quote = await this.dexExecutor.getQuote({
          protocol: protocol as any,
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
        
        const slippageMultiplier = (100 - validatedData.slippage) / 100;
        finalAmountOutMin = BigInt(Math.floor(Number(quote.amountOut) * slippageMultiplier));
      }

      // Execute the swap
      const swapResult = await this.dexExecutor.executeSwap({
        protocol: protocol as any,
        tokenIn: tokenInMatch.address,
        tokenOut: tokenOutMatch.address,
        amountIn: amountInWei,
        amountOutMin: finalAmountOutMin,
        recipient: validatedData.recipient,
        slippageTolerance: validatedData.slippage ? validatedData.slippage / 100 : undefined
      });

      logger.info('Swap executed via API', {
        userId,
        tokenIn: tokenInMatch.symbol,
        tokenOut: tokenOutMatch.symbol,
        amountIn: validatedData.amountIn,
        protocol,
        transactionHash: swapResult.hash
      });

      // Convert output amount to human readable
      const amountOutFormatted = Number(swapResult.amountOut) / Math.pow(10, tokenOutMatch.decimals);

      res.json({
        success: true,
        message: `Successfully swapped ${validatedData.amountIn} ${tokenInMatch.symbol} for ${amountOutFormatted.toFixed(6)} ${tokenOutMatch.symbol}`,
        data: {
          transactionHash: swapResult.hash,
          inputToken: tokenInMatch.symbol,
          outputToken: tokenOutMatch.symbol,
          inputAmount: validatedData.amountIn,
          outputAmount: amountOutFormatted,
          gasUsed: swapResult.gasUsed.toString(),
          protocol,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to execute swap', error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute swap'
      });
    }
  };

  /**
   * Get all supported tokens
   */
  getSupportedTokens = async (req: Request, res: Response) => {
    try {
      const tokens = this.tokenResolver.getAllTokens();
      
      const tokenList = Object.entries(tokens).map(([symbol, tokenInfo]) => ({
        symbol,
        address: tokenInfo.address,
        name: tokenInfo.name,
        decimals: tokenInfo.decimals,
        aliases: tokenInfo.aliases
      }));

      res.json({
        success: true,
        data: tokenList,
        count: tokenList.length
      });

    } catch (error) {
      logger.error('Failed to get supported tokens', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve supported tokens'
      });
    }
  };

  /**
   * Get token information by symbol or address
   */
  getTokenInfo = async (req: Request, res: Response) => {
    try {
      const identifier = req.params.identifier;
      const tokenMatch = await this.tokenResolver.resolveToken(identifier);

      if (!tokenMatch) {
        return res.status(404).json({
          success: false,
          error: 'Token not found'
        });
      }

      res.json({
        success: true,
        data: {
          symbol: tokenMatch.symbol,
          address: tokenMatch.address,
          name: tokenMatch.name,
          decimals: tokenMatch.decimals,
          confidence: tokenMatch.confidence
        }
      });

    } catch (error) {
      logger.error('Failed to get token info', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve token information'
      });
    }
  };

  /**
   * Search tokens by query
   */
  searchTokens = async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      
      if (!query || query.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Query must be at least 2 characters long'
        });
      }

      const results = this.tokenResolver.searchTokens(query);

      res.json({
        success: true,
        data: results,
        count: results.length
      });

    } catch (error) {
      logger.error('Failed to search tokens', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search tokens'
      });
    }
  };

  /**
   * Get supported protocols/DEXes
   */
  getSupportedProtocols = async (req: Request, res: Response) => {
    try {
      const protocols = [
        {
          id: 'dragonswap',
          name: 'DragonSwap',
          type: 'Uniswap V3 Fork',
          fees: ['0.01%', '0.05%', '0.3%', '1%'],
          isActive: true
        },
        {
          id: 'symphony',
          name: 'Symphony',
          type: 'DEX Aggregator',
          fees: ['Variable'],
          isActive: true
        }
      ];

      res.json({
        success: true,
        data: protocols,
        count: protocols.length
      });

    } catch (error) {
      logger.error('Failed to get supported protocols', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve supported protocols'
      });
    }
  };
}