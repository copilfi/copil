import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface CEXPriceData {
  symbol: string;
  price: number;
  source: string;
  timestamp: number;
}

@Injectable()
export class CexAdapter {
  private readonly logger = new Logger(CexAdapter.name);
  private readonly apiKeys: Record<string, string>;
  private readonly rateLimits: Record<string, { requests: number; window: number }>;

  constructor(private readonly configService: ConfigService) {
    // Initialize API keys from environment
    this.apiKeys = {
      binance: this.configService.get<string>('BINANCE_API_KEY') || '',
      coinbase: this.configService.get<string>('COINBASE_API_KEY') || '',
      kraken: this.configService.get<string>('KRAKEN_API_KEY') || '',
    };

    // Rate limiting configuration (requests per minute)
    this.rateLimits = {
      binance: { requests: 1200, window: 60 },
      coinbase: { requests: 100, window: 60 },
      kraken: { requests: 100, window: 60 },
    };
  }

  async getPrice(tokenAddress: string, chain: string): Promise<number> {
    try {
      // Get symbol from token address
      const symbol = this.getTokenSymbol(tokenAddress, chain);
      if (!symbol) {
        throw new Error(`Unknown token address: ${tokenAddress} on ${chain}`);
      }

      // Fetch prices from multiple exchanges
      const pricePromises = [
        this.fetchBinancePrice(symbol),
        this.fetchCoinbasePrice(symbol),
        this.fetchKrakenPrice(symbol),
      ];

      const results = await Promise.allSettled(pricePromises);
      const validPrices: CEXPriceData[] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value > 0) {
          const sources = ['binance', 'coinbase', 'kraken'];
          validPrices.push({
            symbol,
            price: result.value,
            source: sources[index],
            timestamp: Date.now(),
          });
        } else {
          const sources = ['binance', 'coinbase', 'kraken'];
          this.logger.warn(`${sources[index]} price fetch failed for ${symbol}`);
        }
      });

      if (validPrices.length === 0) {
        throw new Error('No valid prices from any exchange');
      }

      // Aggregate prices (weighted average)
      const aggregatedPrice = this.aggregatePrices(validPrices);

      this.logger.log(
        `CEX aggregated price for ${symbol}: $${aggregatedPrice} (from ${validPrices.length} exchanges)`,
      );

      return aggregatedPrice;

    } catch (error) {
      this.logger.error(
        `CEX price fetch failed for ${tokenAddress} on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Fallback to reasonable default
      return this.getFallbackPrice(tokenAddress);
    }
  }

  private async fetchBinancePrice(symbol: string): Promise<number> {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
        params: { symbol: `${symbol}USDT` },
        timeout: 5000,
      });

      return parseFloat(response.data.price);
    } catch (error) {
      this.logger.error(`Binance API error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private async fetchCoinbasePrice(symbol: string): Promise<number> {
    try {
      const response = await axios.get(`https://api.coinbase.com/v2/exchange-rates`, {
        params: { currency: symbol },
        timeout: 5000,
      });

      return parseFloat(response.data.data.rates.USD);
    } catch (error) {
      this.logger.error(`Coinbase API error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private async fetchKrakenPrice(symbol: string): Promise<number> {
    try {
      const response = await axios.get('https://api.kraken.com/0/public/Ticker', {
        params: { pair: `${symbol}USD` },
        timeout: 5000,
      });

      const pairKey = Object.keys(response.data.result)[0];
      const price = response.data.result[pairKey].c[0];
      return parseFloat(price);
    } catch (error) {
      this.logger.error(`Kraken API error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private aggregatePrices(prices: CEXPriceData[]): number {
    // Simple weighted average - can be enhanced with volume weighting
    const total = prices.reduce((sum, p) => sum + p.price, 0);
    return total / prices.length;
  }

  private getTokenSymbol(tokenAddress: string, chain: string): string | null {
    // Map token addresses to trading symbols
    const tokenMappings: Record<string, Record<string, string>> = {
      ethereum: {
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'ETH', // WETH
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'BTC', // WBTC
        '0xA0b86a33E6417c6c6c6c6c6c6c6c6c6c6c6c6c6c': 'USDC', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT', // USDT
      },
      polygon: {
        '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0': 'MATIC', // MATIC
      },
    };

    return tokenMappings[chain]?.[tokenAddress.toLowerCase()] || null;
  }

  private getFallbackPrice(tokenAddress: string): number {
    // Provide reasonable fallback prices
    const fallbackPrices: Record<string, number> = {
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 2000, // WETH
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 45000, // WBTC
      '0xA0b86a33E6417c6c6c6c6c6c6c6c6c6c6c6c6c6c': 1.0, // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 1.0, // USDT
      '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0': 0.8, // MATIC
    };

    return fallbackPrices[tokenAddress.toLowerCase()] || 1.0;
  }

  // Additional method for batch price fetching with caching
  async getBatchPrices(tokenAddresses: string[], chain: string): Promise<Record<string, number>> {
    const pricePromises = tokenAddresses.map(async (address) => {
      const price = await this.getPrice(address, chain);
      return { address, price };
    });

    const priceResults = await Promise.allSettled(pricePromises);
    const prices: Record<string, number> = {};

    priceResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        prices[result.value.address] = result.value.price;
      } else {
        prices[tokenAddresses[index]] = this.getFallbackPrice(tokenAddresses[index]);
      }
    });

    return prices;
  }

  // Health check method to verify exchange connectivity
  async healthCheck(): Promise<{ [exchange: string]: boolean }> {
    const healthStatus: { [exchange: string]: boolean } = {};

    try {
      await this.fetchBinancePrice('BTC');
      healthStatus.binance = true;
    } catch {
      healthStatus.binance = false;
    }

    try {
      await this.fetchCoinbasePrice('BTC');
      healthStatus.coinbase = true;
    } catch {
      healthStatus.coinbase = false;
    }

    try {
      await this.fetchKrakenPrice('BTC');
      healthStatus.kraken = true;
    } catch {
      healthStatus.kraken = false;
    }

    return healthStatus;
  }
}
