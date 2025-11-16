import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class CoingeckoAdapter {
  private readonly logger = new Logger(CoingeckoAdapter.name);
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';

  constructor(private readonly configService: ConfigService) {}

  async getPrice(tokenAddress: string, chain: string): Promise<number> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/simple/token_price/${chain}?contract_addresses=${tokenAddress}&vs_currencies=usd`,
        {
          timeout: 5000,
        },
      );

      // Type-safe access with proper guards
      if (
        response.data &&
        typeof response.data === 'object' &&
        tokenAddress in response.data
      ) {
        const tokenData = response.data[tokenAddress];
        if (
          tokenData &&
          typeof tokenData === 'object' &&
          'usd' in tokenData &&
          typeof tokenData.usd === 'number'
        ) {
          return tokenData.usd;
        }
      }

      throw new Error('No price data found');
    } catch (error) {
      this.logger.error(
        `Coingecko price fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
