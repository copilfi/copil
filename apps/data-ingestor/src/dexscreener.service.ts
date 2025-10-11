import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class DexScreenerService {
  private readonly API_URL = 'https://api.dexscreener.com/latest/dex';

  async getTrendingTokens(chain: string) {
    // Using the /search endpoint which was verified to work.
    // We search for pairs against the chain's native wrapped token.
    const query = `WETH ${chain}`;
    const response = await axios.get(`${this.API_URL}/search`, { params: { q: query } });
    return response.data.pairs;
  }
}
