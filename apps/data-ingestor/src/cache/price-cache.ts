import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { ValidatedPrice } from '@copil/database';

@Injectable()
export class PriceCache {
  private readonly logger = new Logger(PriceCache.name);
  private readonly redis: Redis;
  private readonly ttl: number;

  constructor(
    redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.redis = redis;
    this.ttl = this.configService.get<number>('PRICE_CACHE_TTL', 60); // 60 seconds default
  }

  async get(
    tokenAddress: string,
    chain: string,
  ): Promise<ValidatedPrice | null> {
    try {
      const key = this.generateKey(tokenAddress, chain);
      const cached = await this.redis.get(key);

      if (cached) {
        return JSON.parse(cached) as ValidatedPrice;
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Failed to get cached price: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async set(
    tokenAddress: string,
    chain: string,
    price: ValidatedPrice,
  ): Promise<void> {
    try {
      const key = this.generateKey(tokenAddress, chain);
      await this.redis.setex(key, this.ttl, JSON.stringify(price));
    } catch (error) {
      this.logger.error(
        `Failed to cache price: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private generateKey(tokenAddress: string, chain: string): string {
    return `price:${chain}:${tokenAddress}`;
  }
}
