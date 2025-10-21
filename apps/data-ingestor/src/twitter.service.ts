import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwitterApi } from 'twitter-api-v2';
import Sentiment from 'sentiment';

@Injectable()
export class TwitterService {
  private readonly logger = new Logger(TwitterService.name);
  private readonly client: TwitterApi | null = null;
  private readonly sentiment: Sentiment;

  constructor(private readonly configService: ConfigService) {
    const bearerToken = this.configService.get<string>('TWITTER_BEARER_TOKEN');
    if (bearerToken) {
      this.client = new TwitterApi(bearerToken);
      this.logger.log('Twitter client initialized.');
    } else {
      this.logger.warn('TWITTER_BEARER_TOKEN not found. TwitterService will be disabled.');
    }
    this.sentiment = new Sentiment();
  }

  async getSentimentForTokens(tokenConfigs: { symbol: string; keywords: string[] }[]) {
    if (!this.client) {
      this.logger.warn('Twitter client not initialized, skipping sentiment analysis.');
      return [];
    }

    const results = [];

    for (const config of tokenConfigs) {
      const query = `(${config.keywords.join(' OR ')}) lang:en`;
      try {
        this.logger.log(`Searching tweets for ${config.symbol} with query: ${query}`);
        const response = await this.client.v2.search(query, {
          max_results: 100, // Max results per request (100 is the max for recent search)
          sort_order: 'recency',
        });

        if (response.meta.result_count === 0) {
          this.logger.log(`No recent tweets found for ${config.symbol}`);
          results.push({ symbol: config.symbol, sentimentScore: 0, tweetVolume: 0 });
          continue;
        }

        let totalScore = 0;
        for (const tweet of response.data.data) {
          const result = this.sentiment.analyze(tweet.text);
          totalScore += result.comparative;
        }

        const averageScore = totalScore / response.meta.result_count;
        results.push({
          symbol: config.symbol,
          sentimentScore: averageScore,
          tweetVolume: response.meta.result_count,
        });

      } catch (error) {
        this.logger.error(`Failed to fetch or analyze tweets for ${config.symbol}:`, error);
        results.push({ symbol: config.symbol, sentimentScore: 0, tweetVolume: 0, error: (error as Error).message });
      }
    }
    return results;
  }
}
