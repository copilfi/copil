import { logger } from '@/utils/logger';
import env from '@/config/env';
import { ethers } from 'ethers';
import { DexExecutor, DexProtocol } from '@copil/blockchain';
import { DRAGONSWAP_CONFIG, SYMPHONY_CONFIG } from '@copil/blockchain/dex/common/constants';
import { TokenResolver } from '@copil/ai-agent';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  chainId: number;
  aliases?: string[];
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

interface SupportedDexInfo {
  protocol: DexProtocol;
  name: string;
  type: string;
  feeBps: number;
  routerAddress: string;
}

export interface DEXAggregationServiceLike {
  getBestQuote(params: SwapParams): Promise<AggregatedQuote>;
  getSupportedTokens(): TokenInfo[];
  getTokenInfo(identifier: string): TokenInfo | null;
  searchTokens(query: string): TokenInfo[];
  getSupportedDEXs(): { id: string; name: string; type: string; fees: string[]; isActive: boolean; config: { routerAddress: string } }[];
  isPairSupported(tokenA: string, tokenB: string): Promise<boolean>;
  getRoutePreview(params: SwapParams): Promise<{ dex: string; router: string; estimatedGas: string }>;
  getStatus(): { ready: boolean; reason?: string };
}

export default class DEXAggregationService implements DEXAggregationServiceLike {
  private readonly chainId: number;
  private readonly supportedDexes: SupportedDexInfo[];
  private readonly tokenResolver: TokenResolver;

  constructor(private readonly dexExecutor: DexExecutor, tokenResolver?: TokenResolver) {
    this.chainId = env.NODE_ENV === 'production' ? env.SEI_CHAIN_ID : env.SEI_TESTNET_CHAIN_ID;
    this.tokenResolver = tokenResolver ?? new TokenResolver();
    this.supportedDexes = [
      {
        protocol: DexProtocol.DRAGONSWAP,
        name: 'DragonSwap',
        type: 'Uniswap V3',
        feeBps: 30,
        routerAddress: DRAGONSWAP_CONFIG.routerAddress
      },
      {
        protocol: DexProtocol.SYMPHONY,
        name: 'Symphony',
        type: 'Aggregator',
        feeBps: 20,
        routerAddress: SYMPHONY_CONFIG.routerAddress
      }
    ];
    logger.info('🔄 DEX Aggregation Service initialized with live DEX integrations');
  }

  async getBestQuote(params: SwapParams): Promise<AggregatedQuote> {
    const slippage = Number(params.slippage ?? 0.5);
    const amountIn = Number(params.amountIn);

    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const { tokenIn, tokenOut } = await this.resolveTokens(params.tokenIn, params.tokenOut);
    const amountInWei = ethers.parseUnits(params.amountIn, tokenIn.decimals);

    const quotes = await this.getAllQuotes(tokenIn, tokenOut, amountInWei, slippage);

    if (!quotes.length) {
      throw new Error('No quotes available for the requested pair');
    }

    const bestQuote = quotes[0];
    const worstQuote = quotes[quotes.length - 1];

    const savingsAmount = (parseFloat(bestQuote.amountOut) - parseFloat(worstQuote.amountOut)).toString();
    const savingsPercentage = quotes.length > 1
      ? ((parseFloat(bestQuote.amountOut) - parseFloat(worstQuote.amountOut)) / parseFloat(worstQuote.amountOut)) * 100
      : 0;

    const executionRoute = await this.buildExecutionRoute({
      bestQuote,
      tokenIn,
      tokenOut,
      amountInWei,
      slippage,
      recipient: params.recipient
    });

    return {
      bestQuote,
      allQuotes: quotes,
      savings: {
        amount: savingsAmount,
        percentage: savingsPercentage
      },
      executionRoute
    };
  }

  getSupportedTokens(): TokenInfo[] {
    return this.mapAllTokens();
  }

  getTokenInfo(identifier: string): TokenInfo | null {
    return this.findCachedToken(identifier);
  }

  searchTokens(query: string): TokenInfo[] {
    return this.tokenResolver.searchTokens(query).map((match) => ({
      symbol: match.symbol,
      address: match.address,
      name: match.name,
      decimals: match.decimals,
      chainId: this.chainId
    }));
  }

  getSupportedDEXs(): { id: string; name: string; type: string; fees: string[]; isActive: boolean; config: { routerAddress: string } }[] {
    return this.supportedDexes.map((dex) => ({
      id: dex.protocol,
      name: dex.name,
      type: dex.type,
      fees: [`${(dex.feeBps / 100).toFixed(2)}%`],
      isActive: true,
      config: {
        routerAddress: dex.routerAddress
      }
    }));
  }

  async isPairSupported(tokenA: string, tokenB: string): Promise<boolean> {
    const [resolvedA, resolvedB] = await Promise.all([
      this.resolveTokenInfo(tokenA),
      this.resolveTokenInfo(tokenB)
    ]);

    return Boolean(resolvedA && resolvedB);
  }

  async getRoutePreview(params: SwapParams): Promise<{
    dex: string;
    router: string;
    estimatedGas: string;
  }> {
    const quote = await this.getBestQuote(params);
    return {
      dex: quote.executionRoute.dex,
      router: quote.executionRoute.router,
      estimatedGas: quote.bestQuote.gasEstimate
    };
  }

  getStatus(): { ready: boolean; reason?: string } {
    return { ready: true };
  }

  private async getAllQuotes(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountInWei: bigint,
    slippage: number
  ): Promise<SwapQuote[]> {
    const quotes: SwapQuote[] = [];

    for (const dex of this.supportedDexes) {
      try {
        const result = await this.dexExecutor.getQuote({
          protocol: dex.protocol,
          tokenIn: tokenIn.address as `0x${string}`,
          tokenOut: tokenOut.address as `0x${string}`,
          amountIn: amountInWei
        });

        const amountOutFormatted = ethers.formatUnits(result.amountOut, tokenOut.decimals);

        quotes.push({
          dexName: dex.protocol,
          amountOut: amountOutFormatted,
          amountOutFormatted,
          priceImpact: result.priceImpact,
          gasEstimate: result.gasEstimate.toString(),
          routerAddress: dex.routerAddress,
          route: [tokenIn.address, tokenOut.address],
          slippage
        });
      } catch (error) {
        logger.warn(`Failed to fetch quote from ${dex.name}:`, error instanceof Error ? error.message : error);
      }
    }

    quotes.sort((a, b) => parseFloat(b.amountOut) - parseFloat(a.amountOut));
    return quotes;
  }

  private async buildExecutionRoute(params: {
    bestQuote: SwapQuote;
    tokenIn: TokenInfo;
    tokenOut: TokenInfo;
    amountInWei: bigint;
    slippage: number;
    recipient?: string;
  }) {
    const protocol = params.bestQuote.dexName as DexProtocol;
    const amountOutWei = ethers.parseUnits(params.bestQuote.amountOut, params.tokenOut.decimals);
    const amountOutMin = this.applySlippage(amountOutWei, params.slippage);

    const recipient = params.recipient && ethers.isAddress(params.recipient)
      ? (params.recipient as `0x${string}`)
      : (ZERO_ADDRESS as `0x${string}`);

    const transaction = await this.dexExecutor.buildSwapTransaction({
      protocol,
      tokenIn: params.tokenIn.address as `0x${string}`,
      tokenOut: params.tokenOut.address as `0x${string}`,
      amountIn: params.amountInWei,
      amountOutMin,
      recipient
    });

    return {
      dex: protocol,
      router: transaction.target,
      calldata: transaction.calldata,
      value: transaction.value
    };
  }

  private applySlippage(amount: bigint, slippagePercent: number): bigint {
    const basisPoints = Math.floor(slippagePercent * 100);
    const numerator = BigInt(10000 - basisPoints);
    return (amount * numerator) / 10000n;
  }

  private async resolveTokens(tokenIn: string, tokenOut: string) {
    const [resolvedIn, resolvedOut] = await Promise.all([
      this.resolveTokenInfo(tokenIn),
      this.resolveTokenInfo(tokenOut)
    ]);

    if (!resolvedIn || !resolvedOut) {
      throw new Error('One or both tokens are not supported');
    }

    return {
      tokenIn: resolvedIn,
      tokenOut: resolvedOut
    };
  }

  private mapAllTokens(): TokenInfo[] {
    const tokens = this.tokenResolver.getAllTokens();
    return Object.entries(tokens).map(([symbol, info]) => ({
      symbol,
      address: info.address,
      name: info.name,
      decimals: info.decimals,
      aliases: info.aliases,
      chainId: this.chainId
    }));
  }

  private findCachedToken(identifier: string): TokenInfo | null {
    const normalized = identifier.toLowerCase();
    const tokens = this.tokenResolver.getAllTokens();

    for (const [symbol, info] of Object.entries(tokens)) {
      if (
        symbol.toLowerCase() === normalized ||
        info.address.toLowerCase() === normalized ||
        (info.aliases?.some(alias => alias.toLowerCase() === normalized) ?? false)
      ) {
        return {
          symbol,
          address: info.address,
          name: info.name,
          decimals: info.decimals,
          aliases: info.aliases,
          chainId: this.chainId
        };
      }
    }

    return null;
  }

  private async resolveTokenInfo(identifier: string): Promise<TokenInfo | null> {
    const cached = this.findCachedToken(identifier);
    if (cached) {
      return cached;
    }

    const match = await this.tokenResolver.resolveToken(identifier);

    if (!match) {
      return null;
    }

    return {
      symbol: match.symbol,
      address: match.address,
      name: match.name,
      decimals: match.decimals,
      chainId: this.chainId
    };
  }
}
