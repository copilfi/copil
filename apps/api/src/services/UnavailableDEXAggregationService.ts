import env from '@/config/env';
import { TokenResolver } from '@copil/ai-agent';
import {
  AggregatedQuote,
  DEXAggregationServiceLike,
  SwapParams,
  TokenInfo
} from './DEXAggregationService';

const DEFAULT_REASON = 'DEX aggregation is currently unavailable';

export class UnavailableDEXAggregationService implements DEXAggregationServiceLike {
  private readonly chainId: number;
  private readonly tokenResolver: TokenResolver;

  constructor(private readonly reason: string = DEFAULT_REASON) {
    this.chainId = env.NODE_ENV === 'production' ? env.SEI_CHAIN_ID : env.SEI_TESTNET_CHAIN_ID;
    this.tokenResolver = new TokenResolver();
  }

  async getBestQuote(_params: SwapParams): Promise<AggregatedQuote> {
    throw this.buildUnavailableError();
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
    return [];
  }

  async isPairSupported(_tokenA: string, _tokenB: string): Promise<boolean> {
    return false;
  }

  async getRoutePreview(_params: SwapParams): Promise<{ dex: string; router: string; estimatedGas: string }> {
    throw this.buildUnavailableError();
  }

  getStatus(): { ready: boolean; reason?: string } {
    return { ready: false, reason: this.reason || DEFAULT_REASON };
  }

  private buildUnavailableError(): Error {
    return new Error(this.reason || DEFAULT_REASON);
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
}

export default UnavailableDEXAggregationService;
