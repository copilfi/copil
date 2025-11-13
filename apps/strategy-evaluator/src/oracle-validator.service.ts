import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenPrice } from '@copil/database';
import { firstValueFrom } from 'rxjs';

interface PriceSource {
  name: string;
  url: string;
  getPrice: (data: any, tokenAddress: string) => number | null;
}

@Injectable()
export class OracleValidatorService {
  private readonly logger = new Logger(OracleValidatorService.name);
  private readonly PRICE_SOURCES: PriceSource[] = [
    {
      name: 'dexscreener',
      url: 'https://api.dexscreener.com/latest/dex/tokens',
      getPrice: (data, tokenAddress) => {
        const pairs = data.pairs || [];
        const pair = pairs.find(
          (p: any) =>
            p.baseToken.address.toLowerCase() === tokenAddress.toLowerCase(),
        );
        return pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
      },
    },
    {
      name: 'coingecko',
      url: 'https://api.coingecko.com/api/v3/simple/token_price',
      getPrice: (data, tokenAddress) => {
        return data[tokenAddress.toLowerCase()]?.usd || null;
      },
    },
  ];

  constructor(
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
    private readonly httpService: HttpService,
  ) {}

  async validatePrice(
    chain: string,
    tokenAddress: string,
  ): Promise<{
    ok: boolean;
    price?: number;
    sources: Array<{ name: string; price: number | null }>;
    reason?: string;
  }> {
    const sources: Array<{ name: string; price: number | null }> = [];
    const validPrices: number[] = [];

    // Get price from multiple sources
    for (const source of this.PRICE_SOURCES) {
      try {
        const price = await this.getPriceFromSource(source, tokenAddress);
        sources.push({ name: source.name, price });
        if (price !== null && !isNaN(price) && price > 0) {
          validPrices.push(price);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to get price from ${source.name}: ${(error as Error).message}`,
        );
        sources.push({ name: source.name, price: null });
      }
    }

    // Get our stored price as additional source
    try {
      const storedPrice = await this.getStoredPrice(chain, tokenAddress);
      if (storedPrice !== null) {
        sources.push({ name: 'stored', price: storedPrice });
        validPrices.push(storedPrice);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to get stored price: ${(error as Error).message}`,
      );
      sources.push({ name: 'stored', price: null });
    }

    // Require at least 2 valid sources for consensus
    if (validPrices.length < 2) {
      return {
        ok: false,
        sources,
        reason: `Insufficient valid price sources: ${validPrices.length}/2+ required`,
      };
    }

    // Calculate median price
    const sortedPrices = validPrices.sort((a, b) => a - b);
    const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];

    // Check for outliers (more than 20% deviation from median)
    const maxDeviation = 0.2; // 20%
    const outliers = validPrices.filter(
      (price) => Math.abs((price - medianPrice) / medianPrice) > maxDeviation,
    );

    if (outliers.length > 0) {
      return {
        ok: false,
        sources,
        reason: `Price sources disagree significantly. Median: $${medianPrice.toFixed(4)}, Outliers: ${outliers.map((p) => `$${p.toFixed(4)}`).join(', ')}`,
      };
    }

    return {
      ok: true,
      price: medianPrice,
      sources,
    };
  }

  private async getPriceFromSource(
    source: PriceSource,
    tokenAddress: string,
  ): Promise<number | null> {
    const url = source.url.includes('{address}')
      ? source.url.replace('{address}', tokenAddress)
      : `${source.url}/${tokenAddress}`;

    const response = await firstValueFrom(
      this.httpService.get(url, { timeout: 5000 }),
    );

    return source.getPrice(response.data, tokenAddress);
  }

  private async getStoredPrice(
    chain: string,
    tokenAddress: string,
  ): Promise<number | null> {
    const latest = await this.tokenPriceRepository.findOne({
      where: {
        chain: chain.toLowerCase(),
        address: tokenAddress.toLowerCase(),
      },
      order: { timestamp: 'DESC' },
    });

    if (!latest) {
      return null;
    }

    const ageMs = Date.now() - new Date(latest.timestamp).getTime();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (ageMs > maxAge) {
      return null;
    }

    return latest.priceUsd;
  }
}
