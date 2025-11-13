import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenPrice, TokenSentiment } from '@copil/database';
import { InfoClient, HttpTransport } from '@nktkas/hyperliquid';
import { DexScreenerService } from './dexscreener.service';
import { TwitterService } from './twitter.service';
import axios from 'axios';

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
    const chains = chainsEnv
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

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
            source: 'dexscreener',
          });
          await this.tokenPriceRepository.save(tokenPrice);
        }
      } catch (error) {
        this.logger.error(
          `Error fetching data for ${chain}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    this.logger.log('Finished fetching token data.');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleHyperliquidPriceCron() {
    try {
      const enabled = (process.env.HL_INGEST_ENABLED ?? 'true') === 'true';
      if (!enabled) return;
      const symbols = (process.env.HL_INGEST_SYMBOLS ?? 'BTC,ETH')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!symbols.length) return;
      const transport = new HttpTransport();
      const info = new InfoClient({ transport });
      const mids = await info.allMids();
      let saved = 0;
      for (const sym of symbols) {
        const px = mids[sym];
        if (!px) continue;
        const price = parseFloat(px);
        if (!Number.isFinite(price)) continue;
        const rec = this.tokenPriceRepository.create({
          chain: 'hyperliquid',
          address: sym,
          symbol: sym,
          priceUsd: price,
          source: 'hyperliquid',
        });
        await this.tokenPriceRepository.save(rec);
        saved++;
      }
      if (saved > 0) this.logger.log(`Saved ${saved} Hyperliquid mid prices.`);
    } catch (e) {
      this.logger.warn(
        `Hyperliquid price ingest failed: ${(e as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSolanaPriceCron() {
    try {
      const enabled = (process.env.SOL_INGEST_ENABLED ?? 'true') === 'true';
      if (!enabled) return;
      const raw = process.env.SOL_INGEST_MINTS ?? '';
      const mintPairs = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((item) => {
          const [mint, sym] = item.split(':').map((p) => p.trim());
          return { mint, symbol: sym || undefined } as {
            mint: string;
            symbol?: string;
          };
        });
      if (!mintPairs.length) return;

      const ids = mintPairs.map((m) => m.mint).join(',');
      const base =
        process.env.JUPITER_PRICE_API_URL || 'https://price.jup.ag/v4/price';
      const url = `${base}?ids=${encodeURIComponent(ids)}`;
      const timeout = Number(process.env.DEX_SCREENER_TIMEOUT_MS ?? '8000');
      const res = await axios.get(url, { timeout });
      const data = res.data?.data ?? {};

      let saved = 0;
      for (const mp of mintPairs) {
        const rec = data[mp.mint];
        const price = rec?.price as number | undefined;
        if (!price || !Number.isFinite(price)) continue;
        const symbol =
          mp.symbol ||
          rec?.symbol ||
          (rec?.id as string) ||
          mp.mint.substring(0, 6);
        const row = this.tokenPriceRepository.create({
          chain: 'solana',
          address: mp.mint,
          symbol: String(symbol),
          priceUsd: Number(price),
          source: 'jupiter',
        });
        await this.tokenPriceRepository.save(row);
        saved++;
      }
      if (saved > 0)
        this.logger.log(`Saved ${saved} Solana prices from Jupiter.`);
    } catch (e) {
      this.logger.warn(`Solana price ingest failed: ${(e as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleTwitterCron() {
    this.logger.log('Fetching Twitter sentiment data...');
    const tokensToTrack = [
      { symbol: 'ETH', keywords: ['Ethereum', 'ETH'] },
      { symbol: 'BTC', keywords: ['Bitcoin', 'BTC'] },
      { symbol: 'SOL', keywords: ['Solana', 'SOL'] },
    ];

    const sentimentResults =
      await this.twitterService.getSentimentForTokens(tokensToTrack);

    for (const result of sentimentResults) {
      if (result.error) {
        this.logger.error(
          `Could not process sentiment for ${result.symbol}: ${result.error}`,
        );
        continue;
      }
      const sentimentRecord = this.tokenSentimentRepository.create({
        chain: 'global', // Sentiment is not chain-specific
        symbol: result.symbol,
        sentimentScore: result.sentimentScore,
        tweetVolume: result.tweetVolume,
      });
      await this.tokenSentimentRepository.save(sentimentRecord);
      this.logger.log(
        `Saved sentiment for ${result.symbol}: Score ${result.sentimentScore}, Volume ${result.tweetVolume}`,
      );
    }
    this.logger.log('Finished fetching Twitter sentiment data.');
  }
}
