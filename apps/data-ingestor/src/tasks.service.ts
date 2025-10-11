import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenPrice } from '@copil/database';
import { DexScreenerService } from './dexscreener.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly dexScreenerService: DexScreenerService,
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    console.log('Fetching trending token data...');
    const chains = ['ethereum', 'base', 'arbitrum']; // Example chains

    for (const chain of chains) {
      const pairs = await this.dexScreenerService.getTrendingTokens(chain);
      for (const pair of pairs) {
        const tokenPrice = this.tokenPriceRepository.create({
          chain: chain,
          address: pair.baseToken.address,
          symbol: pair.baseToken.symbol,
          priceUsd: parseFloat(pair.priceUsd),
          timestamp: new Date(),
        });
        await this.tokenPriceRepository.save(tokenPrice);
      }
    }
    console.log('Finished fetching token data.');
  }
}
