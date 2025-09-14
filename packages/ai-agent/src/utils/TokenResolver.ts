import { Address } from 'viem';
import { TokenMatch, TokenDatabase } from '../types';

export class TokenResolver {
  private tokenDatabase: TokenDatabase;

  constructor() {
    this.tokenDatabase = this.initializeTokenDatabase();
  }

  private initializeTokenDatabase(): TokenDatabase {
    return {
      'SEI': {
        address: '0x0000000000000000000000000000000000000000' as Address,
        name: 'SEI',
        decimals: 18,
        aliases: ['sei', 'native-sei']
      },
      'WSEI': {
        address: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7' as Address,
        name: 'Wrapped SEI',
        decimals: 18,
        aliases: ['wrapped-sei', 'wsei']
      },
      // Real SEI mainnet token addresses (2025)
      'USDC': {
        address: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392' as Address, // Native USDC (CCTP V2)
        name: 'USD Coin (Native)',
        decimals: 6,
        aliases: ['usd-coin', 'usdc', 'native-usdc']
      },
      'USDC.n': {
        address: '0x3894085ef7ff0f0aedf52e2a2704928d1ec074f1' as Address, // USDC via Noble (Legacy)
        name: 'USD Coin (Noble)',
        decimals: 6,
        aliases: ['usdc-noble', 'usdcn', 'usdc.n']
      },
      'USDT': {
        address: '0x3E2a59DbfEE8b2FBE6B8C3b6b6f73d6eC7e5E0D0' as Address, // USDT bridged address (estimated)
        name: 'Tether USD',
        decimals: 6,
        aliases: ['tether', 'usdt', 'tether-usd']
      }
    };
  }

  /**
   * Resolve a token symbol or address to token information
   */
  async resolveToken(input: string): Promise<TokenMatch | null> {
    const normalizedInput = input.toLowerCase().trim();

    // Check if it's an address
    if (this.isAddress(input)) {
      return await this.resolveByAddress(input as Address);
    }

    // Check direct symbol match
    const directMatch = this.findBySymbol(normalizedInput);
    if (directMatch) {
      return {
        symbol: directMatch.symbol,
        address: directMatch.address,
        name: directMatch.name,
        decimals: directMatch.decimals,
        confidence: 1.0
      };
    }

    // Check aliases
    const aliasMatch = this.findByAlias(normalizedInput);
    if (aliasMatch) {
      return {
        symbol: aliasMatch.symbol,
        address: aliasMatch.address,
        name: aliasMatch.name,
        decimals: aliasMatch.decimals,
        confidence: 0.9
      };
    }

    // Fuzzy matching
    const fuzzyMatch = this.findByFuzzyMatch(normalizedInput);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    return null;
  }

  private isAddress(input: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(input);
  }

  private async resolveByAddress(address: Address): Promise<TokenMatch | null> {
    // Check if address exists in our database
    for (const [symbol, tokenInfo] of Object.entries(this.tokenDatabase)) {
      if (tokenInfo.address.toLowerCase() === address.toLowerCase()) {
        return {
          symbol,
          address: tokenInfo.address,
          name: tokenInfo.name,
          decimals: tokenInfo.decimals,
          confidence: 1.0
        };
      }
    }

    // If not in database, try to fetch token info from contract
    try {
      const tokenInfo = await this.fetchTokenInfoFromContract(address);
      if (tokenInfo) {
        return {
          symbol: tokenInfo.symbol,
          address,
          name: tokenInfo.name,
          decimals: tokenInfo.decimals,
          confidence: 0.8
        };
      }
    } catch (error) {
      console.warn(`Failed to fetch token info for address ${address}:`, error);
    }

    return null;
  }

  private findBySymbol(symbol: string): { symbol: string; address: Address; name: string; decimals: number } | null {
    const upperSymbol = symbol.toUpperCase();
    if (this.tokenDatabase[upperSymbol]) {
      return {
        symbol: upperSymbol,
        ...this.tokenDatabase[upperSymbol]
      };
    }
    return null;
  }

  private findByAlias(alias: string): { symbol: string; address: Address; name: string; decimals: number } | null {
    for (const [symbol, tokenInfo] of Object.entries(this.tokenDatabase)) {
      if (tokenInfo.aliases.includes(alias)) {
        return {
          symbol,
          ...tokenInfo
        };
      }
    }
    return null;
  }

  private findByFuzzyMatch(input: string): TokenMatch | null {
    let bestMatch: { symbol: string; score: number } | null = null;

    for (const [symbol, tokenInfo] of Object.entries(this.tokenDatabase)) {
      // Check symbol similarity
      const symbolScore = this.calculateSimilarity(input, symbol.toLowerCase());
      if (symbolScore > 0.7 && (!bestMatch || symbolScore > bestMatch.score)) {
        bestMatch = { symbol, score: symbolScore };
      }

      // Check name similarity
      const nameScore = this.calculateSimilarity(input, tokenInfo.name.toLowerCase());
      if (nameScore > 0.7 && (!bestMatch || nameScore > bestMatch.score)) {
        bestMatch = { symbol, score: nameScore };
      }

      // Check aliases
      for (const alias of tokenInfo.aliases) {
        const aliasScore = this.calculateSimilarity(input, alias);
        if (aliasScore > 0.7 && (!bestMatch || aliasScore > bestMatch.score)) {
          bestMatch = { symbol, score: aliasScore };
        }
      }
    }

    if (bestMatch && bestMatch.score > 0.7) {
      const tokenInfo = this.tokenDatabase[bestMatch.symbol];
      return {
        symbol: bestMatch.symbol,
        address: tokenInfo.address,
        name: tokenInfo.name,
        decimals: tokenInfo.decimals,
        confidence: bestMatch.score * 0.8 // Reduced confidence for fuzzy matches
      };
    }

    return null;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  private async fetchTokenInfoFromContract(address: Address): Promise<{
    symbol: string;
    name: string;
    decimals: number;
  } | null> {
    try {
      // Import the necessary web3 libraries
      const { createPublicClient, http } = await import('viem');
      
      // Create client for SEI mainnet
      const client = createPublicClient({
        transport: http('https://evm-rpc.sei-apis.com'),
        chain: {
          id: 1329,
          name: 'SEI Mainnet',
          nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
          rpcUrls: { default: { http: ['https://evm-rpc.sei-apis.com'] } },
          blockExplorers: { default: { name: 'Seitrace', url: 'https://seitrace.com' } }
        }
      });

      // ERC-20 contract ABI for token info functions
      const erc20Abi = [
        {
          "constant": true,
          "inputs": [],
          "name": "name",
          "outputs": [{"name": "", "type": "string"}],
          "type": "function"
        },
        {
          "constant": true,
          "inputs": [],
          "name": "symbol",
          "outputs": [{"name": "", "type": "string"}],
          "type": "function"
        },
        {
          "constant": true,
          "inputs": [],
          "name": "decimals",
          "outputs": [{"name": "", "type": "uint8"}],
          "type": "function"
        }
      ] as const;

      // Fetch token info
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: 'name'
        }),
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: 'symbol'
        }),
        client.readContract({
          address,
          abi: erc20Abi,
          functionName: 'decimals'
        })
      ]);

      return {
        symbol: symbol as string,
        name: name as string,
        decimals: Number(decimals)
      };
    } catch (error) {
      console.warn(`Failed to fetch token info from contract ${address}:`, error);
      return null;
    }
  }

  /**
   * Add a new token to the database
   */
  addToken(symbol: string, address: Address, name: string, decimals: number, aliases: string[] = []): void {
    this.tokenDatabase[symbol.toUpperCase()] = {
      address,
      name,
      decimals,
      aliases: aliases.map(alias => alias.toLowerCase())
    };
  }

  /**
   * Get all supported tokens
   */
  getAllTokens(): TokenDatabase {
    return { ...this.tokenDatabase };
  }

  /**
   * Search tokens by partial name or symbol
   */
  searchTokens(query: string): TokenMatch[] {
    const normalizedQuery = query.toLowerCase();
    const matches: TokenMatch[] = [];

    for (const [symbol, tokenInfo] of Object.entries(this.tokenDatabase)) {
      let confidence = 0;

      // Exact symbol match
      if (symbol.toLowerCase() === normalizedQuery) {
        confidence = 1.0;
      }
      // Symbol starts with query
      else if (symbol.toLowerCase().startsWith(normalizedQuery)) {
        confidence = 0.9;
      }
      // Name contains query
      else if (tokenInfo.name.toLowerCase().includes(normalizedQuery)) {
        confidence = 0.7;
      }
      // Alias match
      else if (tokenInfo.aliases.some(alias => alias.includes(normalizedQuery))) {
        confidence = 0.6;
      }

      if (confidence > 0) {
        matches.push({
          symbol,
          address: tokenInfo.address,
          name: tokenInfo.name,
          decimals: tokenInfo.decimals,
          confidence
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }
}