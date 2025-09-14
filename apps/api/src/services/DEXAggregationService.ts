import { logger } from '@/utils/logger';
import { ethers } from 'ethers';

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  chainId: number;
}

export interface SwapQuote {
  dexName: string;
  amountOut: string;
  amountOutFormatted: string;
  priceImpact: number;
  gasEstimate: string;
  routerAddress: string;
  route: string[];
  slippage: number;
}

export interface AggregatedQuote {
  bestQuote: SwapQuote;
  allQuotes: SwapQuote[];
  savings: {
    amount: string;
    percentage: number;
  };
  executionRoute: {
    dex: string;
    router: string;
    calldata: string;
    value: string;
  };
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: number;
  recipient: string;
  deadline?: number;
}

export class DEXAggregationService {
  private supportedDEXs: Map<string, DEXConfig> = new Map();
  private tokenList: Map<string, TokenInfo> = new Map();

  constructor() {
    this.initializeSupportedDEXs();
    this.initializeTokenList();
    logger.info('🔄 DEX Aggregation Service initialized');
  }

  private initializeSupportedDEXs(): void {
    // Sei Network DEXs
    this.supportedDEXs.set('dragonswap', {
      name: 'DragonSwap',
      routerAddress: '0x0000000000000000000000000000000000000001', // Mock address
      factoryAddress: '0x0000000000000000000000000000000000000002',
      fee: 0.003, // 0.3%
      isActive: true,
      type: 'uniswap-v2'
    });

    this.supportedDEXs.set('astroport', {
      name: 'Astroport',
      routerAddress: '0x0000000000000000000000000000000000000003', // Mock address
      factoryAddress: '0x0000000000000000000000000000000000000004',
      fee: 0.003, // 0.3%
      isActive: true,
      type: 'astroport'
    });

    this.supportedDEXs.set('whitewhale', {
      name: 'White Whale',
      routerAddress: '0x0000000000000000000000000000000000000005', // Mock address
      factoryAddress: '0x0000000000000000000000000000000000000006',
      fee: 0.002, // 0.2%
      isActive: true,
      type: 'whitewhale'
    });
  }

  private initializeTokenList(): void {
    // Mock token list for Sei Network
    const tokens: TokenInfo[] = [
      {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'SEI',
        name: 'Sei',
        decimals: 18,
        chainId: 1329 // Sei testnet
      },
      {
        address: '0x0000000000000000000000000000000000001001',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: 1329
      },
      {
        address: '0x0000000000000000000000000000000000001002',
        symbol: 'WSEI',
        name: 'Wrapped SEI',
        decimals: 18,
        chainId: 1329
      },
      {
        address: '0x0000000000000000000000000000000000001003',
        symbol: 'WETH',
        name: 'Wrapped Ethereum',
        decimals: 18,
        chainId: 1329
      }
    ];

    tokens.forEach(token => {
      this.tokenList.set(token.address.toLowerCase(), token);
      this.tokenList.set(token.symbol.toUpperCase(), token);
    });
  }

  /**
   * Get best swap quote across all supported DEXs
   */
  async getBestQuote(params: SwapParams): Promise<AggregatedQuote> {
    try {
      logger.info(`🔍 Getting quotes for ${params.tokenIn} -> ${params.tokenOut}, amount: ${params.amountIn}`);

      const quotes = await this.getAllQuotes(params);
      
      if (quotes.length === 0) {
        throw new Error('No quotes available for this swap');
      }

      // Sort by amount out (best first)
      quotes.sort((a, b) => parseFloat(b.amountOut) - parseFloat(a.amountOut));
      
      const bestQuote = quotes[0];
      const worstQuote = quotes[quotes.length - 1];
      
      // Calculate savings compared to worst quote
      const savingsAmount = (parseFloat(bestQuote.amountOut) - parseFloat(worstQuote.amountOut)).toString();
      const savingsPercentage = quotes.length > 1 
        ? ((parseFloat(bestQuote.amountOut) - parseFloat(worstQuote.amountOut)) / parseFloat(worstQuote.amountOut)) * 100
        : 0;

      const executionRoute = await this.buildExecutionRoute(bestQuote, params);

      return {
        bestQuote,
        allQuotes: quotes,
        savings: {
          amount: savingsAmount,
          percentage: savingsPercentage
        },
        executionRoute
      };
    } catch (error) {
      logger.error('Failed to get best quote:', error);
      throw error;
    }
  }

  /**
   * Get quotes from all supported DEXs
   */
  private async getAllQuotes(params: SwapParams): Promise<SwapQuote[]> {
    const quotes: SwapQuote[] = [];
    
    for (const [dexId, dexConfig] of this.supportedDEXs) {
      if (!dexConfig.isActive) continue;
      
      try {
        const quote = await this.getQuoteFromDEX(dexId, dexConfig, params);
        if (quote) {
          quotes.push(quote);
        }
      } catch (error) {
        logger.warn(`Failed to get quote from ${dexConfig.name}:`, error);
        // Continue with other DEXs
      }
    }

    return quotes;
  }

  /**
   * Get quote from specific DEX
   */
  private async getQuoteFromDEX(
    dexId: string,
    dexConfig: DEXConfig,
    params: SwapParams
  ): Promise<SwapQuote | null> {
    try {
      // Mock implementation - in production would call actual DEX APIs/contracts
      const mockAmountOut = this.calculateMockAmountOut(params.amountIn, dexConfig.fee);
      const mockPriceImpact = this.calculateMockPriceImpact(parseFloat(params.amountIn));
      
      const tokenInInfo = this.getTokenInfo(params.tokenIn);
      const tokenOutInfo = this.getTokenInfo(params.tokenOut);
      
      if (!tokenInInfo || !tokenOutInfo) {
        logger.warn(`Token info not found for ${params.tokenIn} or ${params.tokenOut}`);
        return null;
      }

      const quote: SwapQuote = {
        dexName: dexConfig.name,
        amountOut: mockAmountOut,
        amountOutFormatted: ethers.formatUnits(mockAmountOut, tokenOutInfo.decimals),
        priceImpact: mockPriceImpact,
        gasEstimate: this.estimateGas(dexConfig.type),
        routerAddress: dexConfig.routerAddress,
        route: [params.tokenIn, params.tokenOut],
        slippage: params.slippage
      };

      logger.debug(`Quote from ${dexConfig.name}: ${quote.amountOutFormatted} ${tokenOutInfo.symbol}`);
      return quote;
    } catch (error) {
      logger.error(`Error getting quote from ${dexConfig.name}:`, error);
      return null;
    }
  }

  /**
   * Build execution route for the best quote
   */
  private async buildExecutionRoute(
    quote: SwapQuote,
    params: SwapParams
  ): Promise<AggregatedQuote['executionRoute']> {
    const iface = new ethers.Interface([
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
      'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
      'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
    ]);

    const deadline = params.deadline || (Math.floor(Date.now() / 1000) + 3600);
    const amountOutMin = ethers.parseUnits(
      (parseFloat(quote.amountOutFormatted) * (1 - params.slippage / 100)).toString(),
      this.getTokenInfo(params.tokenOut)?.decimals || 18
    ).toString();

    let calldata: string;
    let value = '0';

    // Check if input token is native ETH/SEI
    if (params.tokenIn === ethers.ZeroAddress || params.tokenIn.toLowerCase() === 'sei') {
      calldata = iface.encodeFunctionData('swapExactETHForTokens', [
        amountOutMin,
        [params.tokenIn, params.tokenOut],
        params.recipient,
        deadline
      ]);
      value = params.amountIn;
    } else if (params.tokenOut === ethers.ZeroAddress || params.tokenOut.toLowerCase() === 'sei') {
      calldata = iface.encodeFunctionData('swapExactTokensForETH', [
        params.amountIn,
        amountOutMin,
        [params.tokenIn, params.tokenOut],
        params.recipient,
        deadline
      ]);
    } else {
      calldata = iface.encodeFunctionData('swapExactTokensForTokens', [
        params.amountIn,
        amountOutMin,
        [params.tokenIn, params.tokenOut],
        params.recipient,
        deadline
      ]);
    }

    return {
      dex: quote.dexName,
      router: quote.routerAddress,
      calldata,
      value
    };
  }

  /**
   * Get supported tokens
   */
  getSupportedTokens(): TokenInfo[] {
    const uniqueTokens = new Map<string, TokenInfo>();
    
    for (const [key, token] of this.tokenList) {
      if (key.startsWith('0x')) { // Only get address-based entries
        uniqueTokens.set(token.address, token);
      }
    }

    return Array.from(uniqueTokens.values());
  }

  /**
   * Get token info by address or symbol
   */
  getTokenInfo(tokenIdentifier: string): TokenInfo | undefined {
    return this.tokenList.get(tokenIdentifier.toLowerCase()) || 
           this.tokenList.get(tokenIdentifier.toUpperCase());
  }

  /**
   * Get supported DEXs
   */
  getSupportedDEXs(): Array<{ id: string; config: DEXConfig }> {
    return Array.from(this.supportedDEXs.entries()).map(([id, config]) => ({ id, config }));
  }

  /**
   * Check if trading pair is supported
   */
  async isPairSupported(tokenA: string, tokenB: string): Promise<boolean> {
    const tokenAInfo = this.getTokenInfo(tokenA);
    const tokenBInfo = this.getTokenInfo(tokenB);
    
    return !!(tokenAInfo && tokenBInfo);
  }

  // Private helper methods
  private calculateMockAmountOut(amountIn: string, fee: number): string {
    const amountInNum = parseFloat(amountIn);
    const amountOut = amountInNum * (1 - fee) * (0.95 + Math.random() * 0.1); // Mock price variation
    return Math.floor(amountOut).toString();
  }

  private calculateMockPriceImpact(amountIn: number): number {
    // Simulate price impact based on trade size
    if (amountIn < 1000) return 0.1;
    if (amountIn < 10000) return 0.3;
    if (amountIn < 100000) return 0.8;
    return 2.5;
  }

  private estimateGas(dexType: string): string {
    const gasEstimates: { [key: string]: string } = {
      'uniswap-v2': '120000',
      'astroport': '150000',
      'whitewhale': '140000'
    };
    
    return gasEstimates[dexType] || '130000';
  }
}

interface DEXConfig {
  name: string;
  routerAddress: string;
  factoryAddress: string;
  fee: number;
  isActive: boolean;
  type: string;
}

export default DEXAggregationService;