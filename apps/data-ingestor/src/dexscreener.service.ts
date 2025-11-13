import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class DexScreenerService {
  private readonly API_URL =
    process.env.DEX_SCREENER_API_URL ||
    'https://api.dexscreener.com/latest/dex';

  // Key token addresses to track per chain
  private readonly KEY_TOKENS: Record<string, string[]> = {
    base: [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
    ],
    ethereum: [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    ],
    arbitrum: [
      '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    ],
  };

  async getTrendingTokens(chain: string) {
    const chainId = this.getChainId(chain);
    const keyTokens = this.KEY_TOKENS[chainId] || [];
    const allPairs: any[] = [];
    const timeout = Number(process.env.DEX_SCREENER_TIMEOUT_MS ?? '8000');

    // Fetch data for key tokens first
    for (const tokenAddress of keyTokens) {
      try {
        const response = await axios.get(
          `${this.API_URL}/tokens/${tokenAddress}`,
          { timeout },
        );
        const pairs = response.data.pairs || [];
        // Get the pair for this specific chain
        const chainPairs = pairs.filter((p: any) => p.chainId === chainId);
        if (chainPairs.length > 0) {
          allPairs.push(chainPairs[0]); // Add the first pair for this token on this chain
        }
      } catch (error) {
        console.log(`Could not fetch data for token ${tokenAddress}`);
      }
    }

    // Also search for additional trending pairs
    try {
      const searchResponse = await axios.get(`${this.API_URL}/search`, {
        params: { q: `${chainId} USDC` },
        timeout,
      });
      const searchPairs = searchResponse.data.pairs || [];
      const chainPairs = searchPairs
        .filter((pair: any) => pair.chainId === chainId)
        .slice(0, 5);
      allPairs.push(...chainPairs);
    } catch (error) {
      console.log(`Could not search for additional pairs on ${chainId}`);
    }

    // Remove duplicates based on baseToken address
    const uniquePairs = allPairs.filter(
      (pair, index, self) =>
        pair?.baseToken?.address &&
        index ===
          self.findIndex(
            (p) => p?.baseToken?.address === pair.baseToken.address,
          ),
    );

    return uniquePairs.slice(0, 10);
  }

  private getChainId(chain: string): string {
    const chainMap: Record<string, string> = {
      ethereum: 'ethereum',
      base: 'base',
      arbitrum: 'arbitrum',
    };
    return chainMap[chain.toLowerCase()] || chain;
  }
}
