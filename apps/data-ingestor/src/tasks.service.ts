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

  @Cron(CronExpression.EVERY_MINUTE) // Changed to every minute for faster testing
  async handleCron() {
    console.log('Fetching trending token data...');
    const chains = ['ethereum', 'base', 'arbitrum']; // Example chains

    for (const chain of chains) {
      try {
        const pairs = await this.dexScreenerService.getTrendingTokens(chain);
        console.log(`Found ${pairs.length} pairs for ${chain}`);
        
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
      } catch (error) {
        console.error(`Error fetching data for ${chain}:`, error instanceof Error ? error.message : String(error));
      }
    }
    console.log('Finished fetching token data.');
  }
}
