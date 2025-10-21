import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenPrice, TokenSentiment } from '@copil/database';
import { DexScreenerService } from './dexscreener.service';
import { TwitterService } from './twitter.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly dexScreenerService: DexScreenerService,
    private readonly twitterService: TwitterService,
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
    @InjectRepository(TokenSentiment)
    private readonly tokenSentimentRepository: Repository<TokenSentiment>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE) // Changed to every minute for faster testing
  async handleCron() {
    this.logger.log('Fetching trending token data...');
    const chainsEnv = process.env.INGEST_CHAINS || 'ethereum,base,arbitrum';
    const chains = chainsEnv.split(',').map((c) => c.trim()).filter(Boolean);

    for (const chain of chains) {
      try {
        const pairs = await this.dexScreenerService.getTrendingTokens(chain);
        this.logger.log(`Found ${pairs.length} pairs for ${chain}`);
        
        for (const pair of pairs) {
          if (!pair?.priceUsd || isNaN(parseFloat(pair.priceUsd))) {
            continue;
          }
          const tokenPrice = this.tokenPriceRepository.create({
            chain: chain,
            address: pair.baseToken.address,
            symbol: pair.baseToken.symbol,
            priceUsd: parseFloat(pair.priceUsd),
          });
          await this.tokenPriceRepository.save(tokenPrice);
        }
      } catch (error) {
        this.logger.error(`Error fetching data for ${chain}:`, error instanceof Error ? error.message : String(error));
      }
    }
    this.logger.log('Finished fetching token data.');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleTwitterCron() {
    this.logger.log('Fetching Twitter sentiment data...');
    const tokensToTrack = [
      { symbol: 'ETH', keywords: ['Ethereum', 'ETH'] },
      { symbol: 'BTC', keywords: ['Bitcoin', 'BTC'] },
      { symbol: 'SOL', keywords: ['Solana', 'SOL'] },
    ];

    const sentimentResults = await this.twitterService.getSentimentForTokens(tokensToTrack);

    for (const result of sentimentResults) {
      if (result.error) {
        this.logger.error(`Could not process sentiment for ${result.symbol}: ${result.error}`);
        continue;
      }
      const sentimentRecord = this.tokenSentimentRepository.create({
        chain: 'global', // Sentiment is not chain-specific
        symbol: result.symbol,
        sentimentScore: result.sentimentScore,
        tweetVolume: result.tweetVolume,
      });
      await this.tokenSentimentRepository.save(sentimentRecord);
      this.logger.log(`Saved sentiment for ${result.symbol}: Score ${result.sentimentScore}, Volume ${result.tweetVolume}`);
    }
    this.logger.log('Finished fetching Twitter sentiment data.');
  }
}
