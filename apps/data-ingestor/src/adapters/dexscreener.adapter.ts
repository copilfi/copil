import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface PriceResult {
  price: number;
  liquidity?: number;
  volume24h?: number;
  timestamp: Date;
}

@Injectable()
export class DexScreenerAdapter {
  private readonly logger = new Logger(DexScreenerAdapter.name);
  private readonly baseUrl = 'https://api.dexscreener.com/latest/dex';

  constructor(private readonly configService: ConfigService) {}

  async getPrice(tokenAddress: string, chain: string): Promise<number> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/pairs/${chain}/${tokenAddress}`,
        {
          timeout: 5000,
        },
      );

      // Type-safe access with proper guards
      if (
        response.data &&
        typeof response.data === 'object' &&
        'pairs' in response.data &&
        Array.isArray(response.data.pairs) &&
        response.data.pairs.length > 0
      ) {
        const pair = response.data.pairs[0];
        if (pair && typeof pair === 'object') {
          const priceStr =
            'priceUsd' in pair
              ? pair.priceUsd
              : 'priceNative' in pair
                ? pair.priceNative
                : '0';

          if (typeof priceStr === 'string' || typeof priceStr === 'number') {
            return parseFloat(String(priceStr));
          }
        }
      }

      throw new Error('No price data found');
    } catch (error) {
      this.logger.error(
        `DexScreener price fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
