import { Request, Response } from 'express';
import { DexExecutor, DexProtocol } from '@copil/blockchain';
import { TokenResolver } from '@copil/ai-agent';
import { z } from 'zod';
import { AuthenticatedRequest } from '@/middleware/auth';
import { logger } from '@/utils/logger';
import { AutomationSessionService } from '@/services/AutomationSessionService';
import { RealBlockchainService } from '@/services/RealBlockchainService';
import { ethers } from 'ethers';
import { Address } from 'viem';

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
  private dexExecutor: DexExecutor | null;
  private tokenResolver: TokenResolver;
  private blockchainService: RealBlockchainService;
  private automationSessionService: AutomationSessionService;

  constructor(
    dexExecutor: DexExecutor | null,
    blockchainService: RealBlockchainService,
    automationSessionService: AutomationSessionService
  ) {
    this.dexExecutor = dexExecutor;
    this.blockchainService = blockchainService;
    this.automationSessionService = automationSessionService;
    this.tokenResolver = new TokenResolver();
  }

  /**
   * Get real swap quote from DEX aggregator
   */
  getSwapQuote = async (req: Request, res: Response): Promise<void> => {
    try {
      const dexExecutor = this.dexExecutor;

      if (!dexExecutor) {
        res.status(503).json({
          success: false,
          error: 'DEX executor unavailable',
          message: 'Swap quoting is temporarily disabled while on-chain infrastructure initializes.'
        });
        return;
      }

      const validatedData = SwapQuoteSchema.parse(req.body);

      // Resolve token addresses
      const tokenInMatch = await this.tokenResolver.resolveToken(validatedData.tokenIn);
      const tokenOutMatch = await this.tokenResolver.resolveToken(validatedData.tokenOut);

      if (!tokenInMatch || !tokenOutMatch) {
        res.status(400).json({
          success: false,
          error: 'Token not found',
          message: `Could not resolve tokens: ${!tokenInMatch ? validatedData.tokenIn : ''} ${!tokenOutMatch ? validatedData.tokenOut : ''}`
        });
        return;
      }

      // Convert amount to wei
      const amountInWei = ethers.parseUnits(validatedData.amountIn.toString(), tokenInMatch.decimals);

      const requestedProtocol = validatedData.protocol
        ? (validatedData.protocol.toLowerCase() as DexProtocol)
        : undefined;

      let protocolUsed: DexProtocol;
      let quoteResult:
        | Awaited<ReturnType<typeof dexExecutor.getQuote>>
        | Awaited<ReturnType<typeof dexExecutor.getBestQuote>>;

      if (requestedProtocol) {
        quoteResult = await dexExecutor.getQuote({
          protocol: requestedProtocol,
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
        protocolUsed = requestedProtocol;
      } else {
        const bestQuote = await dexExecutor.getBestQuote({
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
        quoteResult = bestQuote;
        protocolUsed = bestQuote.protocol;
      }

      // Convert output amount to human readable
      const amountOutFormatted = Number(ethers.formatUnits(quoteResult.amountOut, tokenOutMatch.decimals));

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
          priceImpact: quoteResult.priceImpact,
          gasEstimate: quoteResult.gasEstimate.toString(),
          protocol: protocolUsed,
          route: [tokenInMatch.address, tokenOutMatch.address], // Simplified route
          timestamp: new Date().toISOString()
        }
      });
      return;

    } catch (error) {
      logger.error('Failed to get swap quote', error);
      
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get swap quote'
      });
      return;
    }
  };

  /**
   * Execute real swap transaction
   */
  executeSwap = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const dexExecutor = this.dexExecutor;

      if (!dexExecutor) {
        res.status(503).json({
          success: false,
          error: 'DEX executor unavailable',
          message: 'Swap execution is temporarily disabled while on-chain infrastructure initializes.'
        });
        return;
      }

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const validatedData = ExecuteSwapSchema.parse(req.body);

      // Resolve token addresses
      const tokenInMatch = await this.tokenResolver.resolveToken(validatedData.tokenIn);
      const tokenOutMatch = await this.tokenResolver.resolveToken(validatedData.tokenOut);

      if (!tokenInMatch || !tokenOutMatch) {
        res.status(400).json({
          success: false,
          error: 'Token not found',
          message: `Could not resolve tokens: ${!tokenInMatch ? validatedData.tokenIn : ''} ${!tokenOutMatch ? validatedData.tokenOut : ''}`
        });
        return;
      }

      // Convert amounts to wei
      const amountInWei = ethers.parseUnits(validatedData.amountIn.toString(), tokenInMatch.decimals);
      const requestedProtocol = validatedData.protocol
        ? (validatedData.protocol.toLowerCase() as DexProtocol)
        : undefined;

      // Determine protocol and quote
      let protocolUsed: DexProtocol;
      let quoteResult:
        | Awaited<ReturnType<typeof dexExecutor.getQuote>>
        | Awaited<ReturnType<typeof dexExecutor.getBestQuote>>;

      if (requestedProtocol) {
        quoteResult = await dexExecutor.getQuote({
          protocol: requestedProtocol,
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
        protocolUsed = requestedProtocol;
      } else {
        const bestQuote = await dexExecutor.getBestQuote({
          tokenIn: tokenInMatch.address,
          tokenOut: tokenOutMatch.address,
          amountIn: amountInWei
        });
        quoteResult = bestQuote;
        protocolUsed = bestQuote.protocol;
      }

      const amountOutWei = quoteResult.amountOut;

      const amountOutMinWei = validatedData.amountOutMin
        ? ethers.parseUnits(validatedData.amountOutMin.toString(), tokenOutMatch.decimals)
        : this.applySlippage(amountOutWei, validatedData.slippage ?? 0.5);

      const userWalletAddress = req.user?.walletAddress;
      if (!userWalletAddress) {
        res.status(400).json({
          success: false,
          error: 'User wallet address not available'
        });
        return;
      }

      const smartAccountAddress = await this.blockchainService.getSmartAccountAddress(userWalletAddress);

      const swapTransaction = await dexExecutor.buildSwapTransaction({
        protocol: protocolUsed,
        tokenIn: tokenInMatch.address as Address,
        tokenOut: tokenOutMatch.address as Address,
        amountIn: amountInWei,
        amountOutMin: amountOutMinWei,
        recipient: smartAccountAddress as Address
      });

      const routerAddress = swapTransaction.target;

      const sessionKey = await this.automationSessionService.ensureSessionKey({
        userId,
        userWalletAddress,
        smartAccountAddress,
        targetContracts: [routerAddress, tokenInMatch.address]
      });

      // Ensure allowance for ERC-20 tokens
      const tokenInIsNative = tokenInMatch.address.toLowerCase() === ethers.ZeroAddress.toLowerCase();
      if (!tokenInIsNative) {
        const currentAllowance = await this.blockchainService.getTokenAllowance(
          tokenInMatch.address,
          smartAccountAddress,
          routerAddress
        );

        if (currentAllowance < amountInWei) {
          const erc20Interface = new ethers.Interface([
            'function approve(address spender, uint256 amount)'
          ]);
          const approveCalldata = erc20Interface.encodeFunctionData('approve', [
            routerAddress,
            ethers.MaxUint256
          ]);

          await this.blockchainService.executeSmartAccountTransaction({
            smartAccountAddress,
            sessionKeyAddress: sessionKey.address,
            targetContract: tokenInMatch.address,
            callData: approveCalldata,
            value: '0'
          });
        }
      }

      const swapTxHash = await this.blockchainService.executeSmartAccountTransaction({
        smartAccountAddress,
        sessionKeyAddress: sessionKey.address,
        targetContract: routerAddress,
        callData: swapTransaction.calldata,
        value: swapTransaction.value
      });

      const quotedAmount = ethers.formatUnits(amountOutWei, tokenOutMatch.decimals);
      const minAmountFormatted = ethers.formatUnits(amountOutMinWei, tokenOutMatch.decimals);

      logger.info('Swap executed via smart account', {
        userId,
        smartAccountAddress,
        tokenIn: tokenInMatch.symbol,
        tokenOut: tokenOutMatch.symbol,
        amountIn: validatedData.amountIn,
        protocol: protocolUsed,
        transactionHash: swapTxHash
      });

      res.json({
        success: true,
        message: `Successfully submitted swap for ${validatedData.amountIn} ${tokenInMatch.symbol}`,
        data: {
          transactionHash: swapTxHash,
          protocol: protocolUsed,
          inputToken: tokenInMatch.symbol,
          outputToken: tokenOutMatch.symbol,
          quotedOutputAmount: quotedAmount,
          minimumOutputAmount: minAmountFormatted,
          gasEstimate: quoteResult.gasEstimate.toString(),
          timestamp: new Date().toISOString()
        }
      });
      return;

    } catch (error) {
      logger.error('Failed to execute swap', error);
      
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute swap'
      });
      return;
    }
  };

  private applySlippage(amount: bigint, slippagePercent: number): bigint {
    const basisPoints = Math.floor(slippagePercent * 100);
    const numerator = BigInt(10000 - basisPoints);
    return (amount * numerator) / 10000n;
  }

  /**
   * Get all supported tokens
   */
  getSupportedTokens = async (req: Request, res: Response): Promise<void> => {
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
      return;
    }
  };

  /**
   * Get token information by symbol or address
   */
  getTokenInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const identifier = req.params.identifier;
      const tokenMatch = await this.tokenResolver.resolveToken(identifier);

      if (!tokenMatch) {
        res.status(404).json({
          success: false,
          error: 'Token not found'
        });
        return;
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
      return;
    }
  };

  /**
   * Search tokens by query
   */
  searchTokens = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query.q as string;
      
      if (!query || query.length < 2) {
        res.status(400).json({
          success: false,
          error: 'Query must be at least 2 characters long'
        });
        return;
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
      return;
    }
  };

  /**
   * Get supported protocols/DEXes
   */
  getSupportedProtocols = async (req: Request, res: Response): Promise<void> => {
    try {
      const protocols = [
        {
          id: 'dragonswap',
          name: 'DragonSwap',
          type: 'Uniswap V3 Fork',
          fees: ['0.01%', '0.05%', '0.3%', '1%'],
          isActive: Boolean(this.dexExecutor)
        },
        {
          id: 'symphony',
          name: 'Symphony',
          type: 'DEX Aggregator',
          fees: ['Variable'],
          isActive: Boolean(this.dexExecutor)
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
      return;
    }
  };
}
