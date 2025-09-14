import axios from 'axios';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import NodeCache from 'node-cache';

export interface CoinGeckoPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap: number;
  market_cap_rank: number;
  fully_diluted_valuation: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  last_updated: string;
}

export interface DeFiLlamaProtocol {
  id: string;
  name: string;
  address: string;
  symbol: string;
  url: string;
  description: string;
  chain: string;
  logo: string;
  audits: string;
  audit_note: string;
  gecko_id: string;
  cmcId: string;
  category: string;
  chains: string[];
  module: string;
  twitter: string;
  forkedFrom: string[];
  oracles: string[];
  listedAt: number;
  slug: string;
  tvl: number;
  chainTvls: Record<string, number>;
  change_1h: number;
  change_1d: number;
  change_7d: number;
  tokenBreakdowns: Record<string, number>;
  mcap: number;
}

export interface MarketMetrics {
  price: number;
  priceChange24h: number;
  priceChangePercentage24h: number;
  marketCap: number;
  volume24h: number;
  tvl?: number;
  dominance?: number;
  fearGreedIndex?: number;
}

export interface TokenMetrics extends MarketMetrics {
  symbol: string;
  name: string;
  rank: number;
  supply: {
    circulating: number;
    total: number;
    max: number;
  };
  ath: {
    price: number;
    changePercentage: number;
    date: string;
  };
  atl: {
    price: number;
    changePercentage: number;
    date: string;
  };
}

export class MarketDataService {
  private coingeckoAxios: any;
  private defilllamaAxios: any;
  private cache: NodeCache;
  private readonly CACHE_TTL = 300; // 5 minutes

  // Token ID mappings for CoinGecko API
  private readonly COINGECKO_IDS: Record<string, string> = {
    'SEI': 'sei-network',
    'ETH': 'ethereum',
    'BTC': 'bitcoin', 
    'USDC': 'usd-coin',
    'USDT': 'tether',
    'WSEI': 'wrapped-sei',
    'WETH': 'weth'
  };

  constructor() {
    // Initialize CoinGecko client
    this.coingeckoAxios = axios.create({
      baseURL: 'https://api.coingecko.com/api/v3',
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        ...(env.COINGECKO_API_KEY && {
          'x-cg-demo-api-key': env.COINGECKO_API_KEY
        })
      }
    });

    // Initialize DeFiLlama client
    this.defilllamaAxios = axios.create({
      baseURL: env.DEFILLLAMA_API_URL || 'https://api.llama.fi',
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    // Cache for reducing API calls
    this.cache = new NodeCache({ 
      stdTTL: this.CACHE_TTL,
      checkperiod: 60
    });

    logger.info('📈 Market Data Service initialized with CoinGecko and DeFiLlama');
  }

  /**
   * Get token price and metrics from CoinGecko
   */
  async getTokenMetrics(symbol: string): Promise<TokenMetrics | null> {
    try {
      const cacheKey = `token_${symbol.toLowerCase()}`;
      const cached = this.cache.get<TokenMetrics>(cacheKey);
      
      if (cached) {
        logger.debug(`📊 Using cached metrics for ${symbol}`);
        return cached;
      }

      const coinId = this.COINGECKO_IDS[symbol.toUpperCase()];
      if (!coinId) {
        logger.warn(`❌ No CoinGecko ID found for ${symbol}`);
        return null;
      }

      const response = await this.coingeckoAxios.get(`/coins/${coinId}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false
        }
      });

      const data = response.data;
      const marketData = data.market_data;

      const metrics: TokenMetrics = {
        symbol: symbol.toUpperCase(),
        name: data.name,
        rank: marketData.market_cap_rank || 0,
        price: marketData.current_price?.usd || 0,
        priceChange24h: marketData.price_change_24h || 0,
        priceChangePercentage24h: marketData.price_change_percentage_24h || 0,
        marketCap: marketData.market_cap?.usd || 0,
        volume24h: marketData.total_volume?.usd || 0,
        supply: {
          circulating: marketData.circulating_supply || 0,
          total: marketData.total_supply || 0,
          max: marketData.max_supply || 0
        },
        ath: {
          price: marketData.ath?.usd || 0,
          changePercentage: marketData.ath_change_percentage?.usd || 0,
          date: marketData.ath_date?.usd || ''
        },
        atl: {
          price: marketData.atl?.usd || 0,
          changePercentage: marketData.atl_change_percentage?.usd || 0,
          date: marketData.atl_date?.usd || ''
        }
      };

      this.cache.set(cacheKey, metrics);
      logger.info(`📊 ${symbol} metrics: $${metrics.price.toFixed(6)} (${metrics.priceChangePercentage24h.toFixed(2)}%)`);
      
      return metrics;

    } catch (error) {
      logger.error(`❌ Error fetching metrics for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get multiple token prices
   */
  async getMultipleTokenPrices(symbols: string[]): Promise<Record<string, number>> {
    try {
      const cacheKey = `prices_${symbols.sort().join('_')}`;
      const cached = this.cache.get<Record<string, number>>(cacheKey);
      
      if (cached) {
        logger.debug('📊 Using cached multi-token prices');
        return cached;
      }

      const coinIds = symbols
        .map(symbol => this.COINGECKO_IDS[symbol.toUpperCase()])
        .filter(Boolean);

      if (coinIds.length === 0) {
        logger.warn('❌ No valid CoinGecko IDs found for symbols:', symbols);
        return {};
      }

      const response = await this.coingeckoAxios.get('/simple/price', {
        params: {
          ids: coinIds.join(','),
          vs_currencies: 'usd',
          include_24hr_change: 'true'
        }
      });

      const prices: Record<string, number> = {};
      
      for (const [symbol, coinId] of Object.entries(this.COINGECKO_IDS)) {
        if (symbols.includes(symbol) && response.data[coinId]) {
          prices[symbol] = response.data[coinId].usd || 0;
        }
      }

      this.cache.set(cacheKey, prices, 60); // Cache for 1 minute
      return prices;

    } catch (error) {
      logger.error('❌ Error fetching multiple token prices:', error);
      return {};
    }
  }

  /**
   * Get DeFi protocol TVL and metrics from DeFiLlama
   */
  async getProtocolMetrics(protocol: string): Promise<DeFiLlamaProtocol | null> {
    try {
      const cacheKey = `protocol_${protocol.toLowerCase()}`;
      const cached = this.cache.get<DeFiLlamaProtocol>(cacheKey);
      
      if (cached) {
        logger.debug(`📊 Using cached protocol metrics for ${protocol}`);
        return cached;
      }

      const response = await this.defilllamaAxios.get(`/protocol/${protocol}`);
      const data = response.data;

      this.cache.set(cacheKey, data);
      logger.info(`📊 ${protocol} TVL: $${(data.tvl / 1e6).toFixed(2)}M`);
      
      return data;

    } catch (error) {
      logger.error(`❌ Error fetching protocol metrics for ${protocol}:`, error);
      return null;
    }
  }

  /**
   * Get SEI Network ecosystem TVL
   */
  async getSeiEcosystemTVL(): Promise<{
    totalTvl: number;
    protocols: Array<{
      name: string;
      tvl: number;
      change24h: number;
    }>;
  }> {
    try {
      const cacheKey = 'sei_ecosystem_tvl';
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        logger.debug('📊 Using cached SEI ecosystem TVL');
        return cached as any;
      }

      // Get all protocols on SEI Network
      const response = await this.defilllamaAxios.get('/protocols');
      const allProtocols = response.data;

      // Filter for SEI protocols
      const seiProtocols = allProtocols.filter((protocol: any) => 
        protocol.chains?.includes('Sei') || 
        protocol.chain === 'Sei' ||
        protocol.name.toLowerCase().includes('sei')
      );

      const totalTvl = seiProtocols.reduce((sum: number, protocol: any) => sum + (protocol.tvl || 0), 0);

      const protocols = seiProtocols.map((protocol: any) => ({
        name: protocol.name,
        tvl: protocol.tvl || 0,
        change24h: protocol.change_1d || 0
      }));

      const result = {
        totalTvl,
        protocols: protocols.sort((a: any, b: any) => b.tvl - a.tvl)
      };

      this.cache.set(cacheKey, result);
      logger.info(`📊 SEI Ecosystem TVL: $${(totalTvl / 1e6).toFixed(2)}M across ${protocols.length} protocols`);
      
      return result;

    } catch (error) {
      logger.error('❌ Error fetching SEI ecosystem TVL:', error);
      return {
        totalTvl: 0,
        protocols: []
      };
    }
  }

  /**
   * Get Fear & Greed Index
   */
  async getFearGreedIndex(): Promise<{
    value: number;
    classification: string;
    timestamp: number;
  } | null> {
    try {
      const cacheKey = 'fear_greed_index';
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        return cached as any;
      }

      // Alternative.me Fear & Greed Index
      const response = await axios.get('https://api.alternative.me/fng/', {
        timeout: 5000
      });

      const data = response.data.data[0];
      const result = {
        value: parseInt(data.value),
        classification: data.value_classification,
        timestamp: parseInt(data.timestamp)
      };

      this.cache.set(cacheKey, result, 3600); // Cache for 1 hour
      return result;

    } catch (error) {
      logger.error('❌ Error fetching Fear & Greed Index:', error);
      return null;
    }
  }

  /**
   * Get trending tokens
   */
  async getTrendingTokens(limit: number = 10): Promise<Array<{
    symbol: string;
    name: string;
    price: number;
    priceChange24h: number;
    marketCap: number;
    volume24h: number;
  }>> {
    try {
      const cacheKey = `trending_tokens_${limit}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        return cached as any;
      }

      const response = await this.coingeckoAxios.get('/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'volume_desc',
          per_page: limit,
          page: 1,
          sparkline: false,
          price_change_percentage: '24h'
        }
      });

      const tokens = response.data.map((coin: any) => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price || 0,
        priceChange24h: coin.price_change_percentage_24h || 0,
        marketCap: coin.market_cap || 0,
        volume24h: coin.total_volume || 0
      }));

      this.cache.set(cacheKey, tokens, 300); // Cache for 5 minutes
      return tokens;

    } catch (error) {
      logger.error('❌ Error fetching trending tokens:', error);
      return [];
    }
  }

  /**
   * Get market overview
   */
  async getMarketOverview(): Promise<{
    totalMarketCap: number;
    totalVolume: number;
    btcDominance: number;
    ethDominance: number;
    marketCapChange24h: number;
    activeCoins: number;
    fearGreedIndex?: number;
  }> {
    try {
      const cacheKey = 'market_overview';
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        return cached as any;
      }

      const [globalResponse, fearGreed] = await Promise.allSettled([
        this.coingeckoAxios.get('/global'),
        this.getFearGreedIndex()
      ]);

      const globalData = globalResponse.status === 'fulfilled' ? globalResponse.value.data.data : null;
      const fearGreedData = fearGreed.status === 'fulfilled' ? fearGreed.value : null;

      const overview = {
        totalMarketCap: globalData?.total_market_cap?.usd || 0,
        totalVolume: globalData?.total_volume?.usd || 0,
        btcDominance: globalData?.market_cap_percentage?.btc || 0,
        ethDominance: globalData?.market_cap_percentage?.eth || 0,
        marketCapChange24h: globalData?.market_cap_change_percentage_24h_usd || 0,
        activeCoins: globalData?.active_cryptocurrencies || 0,
        ...(fearGreedData && { fearGreedIndex: fearGreedData.value })
      };

      this.cache.set(cacheKey, overview, 300);
      return overview;

    } catch (error) {
      logger.error('❌ Error fetching market overview:', error);
      return {
        totalMarketCap: 0,
        totalVolume: 0,
        btcDominance: 0,
        ethDominance: 0,
        marketCapChange24h: 0,
        activeCoins: 0
      };
    }
  }

  /**
   * Get service health
   */
  async getHealthStatus(): Promise<{
    coingecko: 'healthy' | 'unhealthy';
    defillama: 'healthy' | 'unhealthy';
    latency: {
      coingecko: number;
      defillama: number;
    };
  }> {
    const startTime = Date.now();
    
    const [coingeckoTest, defillamaTest] = await Promise.allSettled([
      this.coingeckoAxios.get('/ping'),
      this.defilllamaAxios.get('/protocols')
    ]);

    const coingeckoLatency = Date.now() - startTime;
    const defillamaLatency = Date.now() - startTime;

    return {
      coingecko: coingeckoTest.status === 'fulfilled' ? 'healthy' : 'unhealthy',
      defillama: defillamaTest.status === 'fulfilled' ? 'healthy' : 'unhealthy',
      latency: {
        coingecko: coingeckoLatency,
        defillama: defillamaLatency
      }
    };
  }
}

export default MarketDataService;