import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenPrice, TokenSentiment } from '@copil/database';

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepo: Repository<TokenPrice>,
    @InjectRepository(TokenSentiment)
    private readonly tokenSentimentRepo: Repository<TokenSentiment>,
  ) {}

  /**
   * Returns latest unique tokens per (chain,address) ordered by recency as a proxy for "trending".
   */
  async getTrending(params?: { chain?: string; limit?: number }) {
    const chain = params?.chain?.toLowerCase();
    const limit = Math.max(1, Math.min(params?.limit ?? 10, 50));

    // Fetch a window of recent rows to dedupe in memory
    const take = Math.max(limit * 10, 100);
    const where: any = chain ? { chain } : {};
    const rows = await this.tokenPriceRepo.find({ where, order: { timestamp: 'DESC' }, take });
    const seen = new Set<string>();
    const out: Array<{ chain: string; address: string; symbol: string; priceUsd: number; timestamp: string }> = [];
    for (const r of rows) {
      const key = `${r.chain.toLowerCase()}|${r.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chain: r.chain, address: r.address, symbol: r.symbol, priceUsd: Number(r.priceUsd), timestamp: r.timestamp.toISOString() });
      if (out.length >= limit) break;
    }
    return out;
  }

  async getTokenSentiment(symbol: string) {
    const sym = symbol.toUpperCase();
    const row = await this.tokenSentimentRepo.findOne({ where: { symbol: sym }, order: { timestamp: 'DESC' } });
    if (!row) return { symbol: sym, found: false };
    return { symbol: sym, found: true, sentimentScore: row.sentimentScore, tweetVolume: row.tweetVolume, timestamp: row.timestamp };
  }
}
