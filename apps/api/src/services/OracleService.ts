import { HermesClient } from '@pythnetwork/hermes-client';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import NodeCache from 'node-cache';

export interface PriceData {
  symbol: string;
  price: number;
  confidence: number;
  publishTime: number;
  expo: number;
}

export interface PriceFeed {
  id: string;
  symbol: string;
  pythId: string;
  description: string;
}

export class OracleService {
  private hermesClient: HermesClient;
  private priceCache: NodeCache;
  private readonly CACHE_TTL = 10; // 10 seconds cache

  // Pyth price feed IDs for SEI Network tokens
  private readonly PRICE_FEEDS: Record<string, PriceFeed> = {
    'SEI': {
      id: 'sei',
      symbol: 'SEI',
      pythId: '0x53614f1cb0c031d4af66c04cb9c756234adad0e1cee85303795091499a4084eb',
      description: 'SEI/USD'
    },
    'ETH': {
      id: 'ethereum',
      symbol: 'ETH', 
      pythId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
      description: 'ETH/USD'
    },
    'BTC': {
      id: 'bitcoin',
      symbol: 'BTC',
      pythId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
      description: 'BTC/USD'
    },
    'USDC': {
      id: 'usd-coin',
      symbol: 'USDC',
      pythId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
      description: 'USDC/USD'
    },
    'USDT': {
      id: 'tether',
      symbol: 'USDT', 
      pythId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
      description: 'USDT/USD'
    }
  };

  constructor() {
    const pythUrl = env.PYTH_PRICE_SERVICE_URL || 'https://hermes.pyth.network';
    
    this.hermesClient = new HermesClient(pythUrl, {
      timeout: 10000
    });

    // Cache prices for 10 seconds to avoid rate limits
    this.priceCache = new NodeCache({ 
      stdTTL: this.CACHE_TTL,
      checkperiod: 5
    });

    logger.info(`🔮 Oracle Service initialized with Pyth endpoint: ${pythUrl}`);
  }

  /**
   * Get current price for a token from Pyth Network
   */
  async getPrice(symbol: string): Promise<PriceData | null> {
    try {
      const cacheKey = `price_${symbol.toUpperCase()}`;
      const cachedPrice = this.priceCache.get<PriceData>(cacheKey);
      
      if (cachedPrice) {
        logger.debug(`📊 Using cached price for ${symbol}: $${cachedPrice.price}`);
        return cachedPrice;
      }

      const feed = this.PRICE_FEEDS[symbol.toUpperCase()];
      if (!feed) {
        logger.warn(`❌ No price feed configured for ${symbol}`);
        return null;
      }

      // Get latest price updates from Pyth
      const priceUpdates = await this.hermesClient.getLatestPriceUpdates([feed.pythId]);
      
      if (!priceUpdates || priceUpdates.length === 0) {
        logger.error(`❌ No price updates received for ${symbol}`);
        return null;
      }

      // Parse the price data
      const priceData = priceUpdates[0];
      const parsedPrice = this.parsePythPrice(priceData);
      
      if (!parsedPrice) {
        logger.error(`❌ Failed to parse price data for ${symbol}`);
        return null;
      }

      const result: PriceData = {
        symbol: symbol.toUpperCase(),
        price: parsedPrice.price,
        confidence: parsedPrice.confidence,
        publishTime: parsedPrice.publishTime,
        expo: parsedPrice.expo
      };

      // Cache the result
      this.priceCache.set(cacheKey, result);
      
      logger.info(`📊 ${symbol} price: $${result.price.toFixed(6)} (conf: ${result.confidence.toFixed(6)})`);
      return result;

    } catch (error) {
      logger.error(`❌ Error fetching price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get prices for multiple tokens
   */
  async getPrices(symbols: string[]): Promise<Record<string, PriceData | null>> {
    const results: Record<string, PriceData | null> = {};
    
    // Process requests concurrently but with some delay to avoid rate limits
    const promises = symbols.map(async (symbol, index) => {
      // Add small delay to avoid overwhelming the API
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 100 * index));
      }
      
      const price = await this.getPrice(symbol);
      results[symbol.toUpperCase()] = price;
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Check if price meets a condition
   */
  async checkPriceCondition(
    symbol: string,
    condition: 'above' | 'below' | 'equal',
    targetPrice: number,
    tolerance: number = 0.001 // 0.1% tolerance for 'equal'
  ): Promise<{ met: boolean; currentPrice: number | null; reason: string }> {
    try {
      const priceData = await this.getPrice(symbol);
      
      if (!priceData) {
        return {
          met: false,
          currentPrice: null,
          reason: `Unable to fetch price for ${symbol}`
        };
      }

      const currentPrice = priceData.price;
      let met = false;
      let reason = '';

      switch (condition) {
        case 'above':
          met = currentPrice > targetPrice;
          reason = `${symbol} price ${currentPrice.toFixed(6)} is ${met ? 'above' : 'below'} target ${targetPrice}`;
          break;
          
        case 'below':
          met = currentPrice < targetPrice;
          reason = `${symbol} price ${currentPrice.toFixed(6)} is ${met ? 'below' : 'above'} target ${targetPrice}`;
          break;
          
        case 'equal':
          const diff = Math.abs(currentPrice - targetPrice) / targetPrice;
          met = diff <= tolerance;
          reason = `${symbol} price ${currentPrice.toFixed(6)} is ${met ? 'within' : 'outside'} ${(tolerance * 100).toFixed(1)}% of target ${targetPrice}`;
          break;
      }

      return {
        met,
        currentPrice,
        reason
      };

    } catch (error) {
      logger.error(`❌ Error checking price condition for ${symbol}:`, error);
      return {
        met: false,
        currentPrice: null,
        reason: `Error checking price condition: ${error}`
      };
    }
  }

  /**
   * Get historical prices (limited functionality with Hermes)
   */
  async getHistoricalPrices(symbol: string, hours: number = 24): Promise<PriceData[]> {
    try {
      const feed = this.PRICE_FEEDS[symbol.toUpperCase()];
      if (!feed) {
        logger.warn(`❌ No price feed configured for ${symbol}`);
        return [];
      }

      // For historical data, we would need to use Pyth's historical API
      // For now, return current price as single data point
      const currentPrice = await this.getPrice(symbol);
      return currentPrice ? [currentPrice] : [];

    } catch (error) {
      logger.error(`❌ Error fetching historical prices for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Get all supported price feeds
   */
  getSupportedFeeds(): PriceFeed[] {
    return Object.values(this.PRICE_FEEDS);
  }

  /**
   * Parse Pyth price data from binary format
   */
  private parsePythPrice(priceUpdate: any): {
    price: number;
    confidence: number;
    publishTime: number;
    expo: number;
  } | null {
    try {
      // The price update should contain the parsed price data
      // This is a simplified parser - in production you'd want more robust parsing
      const price = priceUpdate.price?.price || 0;
      const conf = priceUpdate.price?.conf || 0;
      const expo = priceUpdate.price?.expo || 0;
      const publishTime = priceUpdate.price?.publishTime || Date.now();

      // Convert from Pyth's format (price * 10^expo) to decimal
      const normalizedPrice = price * Math.pow(10, expo);
      const normalizedConf = conf * Math.pow(10, expo);

      return {
        price: Math.abs(normalizedPrice), // Ensure positive price
        confidence: Math.abs(normalizedConf),
        publishTime: typeof publishTime === 'number' ? publishTime : parseInt(publishTime),
        expo
      };

    } catch (error) {
      logger.error('❌ Error parsing Pyth price data:', error);
      return null;
    }
  }

  /**
   * Subscribe to real-time price updates (for WebSocket integration)
   */
  async subscribeToPriceUpdates(
    symbols: string[],
    callback: (symbol: string, priceData: PriceData) => void
  ): Promise<void> {
    // Set up polling interval for price updates
    const updateInterval = setInterval(async () => {
      try {
        const prices = await this.getPrices(symbols);
        
        for (const [symbol, priceData] of Object.entries(prices)) {
          if (priceData) {
            callback(symbol, priceData);
          }
        }
      } catch (error) {
        logger.error('❌ Error in price update subscription:', error);
      }
    }, 5000); // Update every 5 seconds

    logger.info(`🔔 Subscribed to price updates for: ${symbols.join(', ')}`);

    // Return cleanup function (would be stored in service registry)
    process.on('SIGINT', () => {
      clearInterval(updateInterval);
      logger.info('🛑 Price update subscription cleaned up');
    });
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency: number;
    activeFeeds: number;
    lastUpdate: number;
  }> {
    const startTime = Date.now();
    
    try {
      // Test with SEI price
      const testPrice = await this.getPrice('SEI');
      const latency = Date.now() - startTime;
      
      return {
        status: testPrice ? 'healthy' : 'degraded',
        latency,
        activeFeeds: Object.keys(this.PRICE_FEEDS).length,
        lastUpdate: testPrice?.publishTime || 0
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        activeFeeds: 0,
        lastUpdate: 0
      };
    }
  }
}

export default OracleService;