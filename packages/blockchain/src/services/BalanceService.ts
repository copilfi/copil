import { ethers, Contract } from 'ethers';
import { BlockchainLogger } from '../utils/Logger';

const logger = BlockchainLogger.getInstance();

// Standard ERC-20 ABI
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
}

export interface TokenBalance {
  token: TokenInfo;
  balance: string;
  formattedBalance: string;
  priceUsd?: number;
  valueUsd?: number;
}

export interface WalletBalances {
  address: string;
  nativeBalance: string;
  tokenBalances: TokenBalance[];
  totalValueUsd: number;
  lastUpdated: number;
}

export interface AllowanceInfo {
  token: string;
  owner: string;
  spender: string;
  allowance: string;
  formattedAllowance: string;
  isUnlimited: boolean;
}

export class BalanceService {
  private provider: ethers.Provider;
  private tokenInfoCache: Map<string, TokenInfo> = new Map();
  private balanceCache: Map<string, WalletBalances> = new Map();
  private readonly CACHE_DURATION = 30000; // 30 seconds
  private readonly MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  constructor(provider: ethers.Provider) {
    this.provider = provider;
    logger.info('BalanceService initialized');
  }

  /**
   * Get token information
   */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const cacheKey = tokenAddress.toLowerCase();
    
    if (this.tokenInfoCache.has(cacheKey)) {
      return this.tokenInfoCache.get(cacheKey)!;
    }

    try {
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        contract.name().catch(() => 'Unknown Token'),
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.decimals().catch(() => 18),
        contract.totalSupply().catch(() => BigInt(0))
      ]);

      const tokenInfo: TokenInfo = {
        address: tokenAddress,
        name,
        symbol,
        decimals: Number(decimals),
        totalSupply: totalSupply.toString()
      };

      this.tokenInfoCache.set(cacheKey, tokenInfo);
      logger.debug(`Cached token info for ${symbol}: ${tokenAddress}`);
      
      return tokenInfo;
    } catch (error) {
      logger.error(`Failed to get token info for ${tokenAddress}:`, error);
      
      // Return default token info on failure
      const defaultInfo: TokenInfo = {
        address: tokenAddress,
        name: 'Unknown Token',
        symbol: 'UNKNOWN',
        decimals: 18
      };
      
      return defaultInfo;
    }
  }

  /**
   * Get native token balance (ETH/SEI)
   */
  async getNativeBalance(walletAddress: string): Promise<string> {
    try {
      const balance = await this.provider.getBalance(walletAddress);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error(`Failed to get native balance for ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get ERC-20 token balance
   */
  async getTokenBalance(
    walletAddress: string, 
    tokenAddress: string
  ): Promise<TokenBalance> {
    try {
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      
      const balance = await contract.balanceOf(walletAddress);
      const formattedBalance = ethers.formatUnits(balance, tokenInfo.decimals);

      return {
        token: tokenInfo,
        balance: balance.toString(),
        formattedBalance,
        priceUsd: 0, // Would be fetched from price oracle in production
        valueUsd: 0
      };
    } catch (error) {
      logger.error(`Failed to get token balance for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get multiple token balances for a wallet
   */
  async getTokenBalances(
    walletAddress: string,
    tokenAddresses: string[]
  ): Promise<TokenBalance[]> {
    const balancePromises = tokenAddresses.map(tokenAddress =>
      this.getTokenBalance(walletAddress, tokenAddress)
    );

    try {
      const balances = await Promise.allSettled(balancePromises);
      
      return balances
        .filter((result): result is PromiseFulfilledResult<TokenBalance> => 
          result.status === 'fulfilled'
        )
        .map(result => result.value);
    } catch (error) {
      logger.error(`Failed to get token balances for ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get complete wallet balances (native + tokens)
   */
  async getWalletBalances(
    walletAddress: string,
    tokenAddresses: string[] = [],
    forceRefresh: boolean = false
  ): Promise<WalletBalances> {
    const cacheKey = walletAddress.toLowerCase();
    const now = Date.now();

    // Check cache first
    if (!forceRefresh && this.balanceCache.has(cacheKey)) {
      const cached = this.balanceCache.get(cacheKey)!;
      if (now - cached.lastUpdated < this.CACHE_DURATION) {
        logger.debug(`Returning cached balances for ${walletAddress}`);
        return cached;
      }
    }

    try {
      logger.info(`Fetching balances for ${walletAddress}`);
      
      // Get native balance
      const nativeBalance = await this.getNativeBalance(walletAddress);
      
      // Get token balances
      const tokenBalances = tokenAddresses.length > 0 
        ? await this.getTokenBalances(walletAddress, tokenAddresses)
        : [];

      // Calculate total value (would use real price data in production)
      const totalValueUsd = parseFloat(nativeBalance) * 100 + // Mock native price
        tokenBalances.reduce((sum, token) => sum + (token.valueUsd || 0), 0);

      const walletBalances: WalletBalances = {
        address: walletAddress,
        nativeBalance,
        tokenBalances,
        totalValueUsd,
        lastUpdated: now
      };

      // Cache the result
      this.balanceCache.set(cacheKey, walletBalances);
      
      logger.info(`Fetched balances for ${walletAddress}:`);
      logger.info(`  Native: ${nativeBalance} ETH`);
      logger.info(`  Tokens: ${tokenBalances.length}`);
      logger.info(`  Total Value: $${totalValueUsd.toFixed(2)}`);

      return walletBalances;
    } catch (error) {
      logger.error(`Failed to get wallet balances for ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Check if wallet has sufficient native balance
   */
  async hasSufficientNativeBalance(
    walletAddress: string,
    requiredAmount: string
  ): Promise<boolean> {
    try {
      const balance = await this.getNativeBalance(walletAddress);
      const required = parseFloat(requiredAmount);
      const available = parseFloat(balance);

      const hasSufficient = available >= required;
      
      if (!hasSufficient) {
        logger.warn(`Insufficient native balance for ${walletAddress}`);
        logger.warn(`  Required: ${required} ETH`);
        logger.warn(`  Available: ${available} ETH`);
      }

      return hasSufficient;
    } catch (error) {
      logger.error(`Failed to check native balance for ${walletAddress}:`, error);
      return false;
    }
  }

  /**
   * Check if wallet has sufficient token balance
   */
  async hasSufficientTokenBalance(
    walletAddress: string,
    tokenAddress: string,
    requiredAmount: string
  ): Promise<boolean> {
    try {
      const tokenBalance = await this.getTokenBalance(walletAddress, tokenAddress);
      const required = parseFloat(requiredAmount);
      const available = parseFloat(tokenBalance.formattedBalance);

      const hasSufficient = available >= required;
      
      if (!hasSufficient) {
        logger.warn(`Insufficient token balance for ${walletAddress}`);
        logger.warn(`  Token: ${tokenBalance.token.symbol}`);
        logger.warn(`  Required: ${required}`);
        logger.warn(`  Available: ${available}`);
      }

      return hasSufficient;
    } catch (error) {
      logger.error(`Failed to check token balance for ${walletAddress}:`, error);
      return false;
    }
  }

  /**
   * Get token allowance
   */
  async getTokenAllowance(
    tokenAddress: string,
    owner: string,
    spender: string
  ): Promise<AllowanceInfo> {
    try {
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      
      const allowance = await contract.allowance(owner, spender);
      const formattedAllowance = ethers.formatUnits(allowance, tokenInfo.decimals);
      const isUnlimited = allowance.toString() === this.MAX_UINT256;

      return {
        token: tokenAddress,
        owner,
        spender,
        allowance: allowance.toString(),
        formattedAllowance,
        isUnlimited
      };
    } catch (error) {
      logger.error(`Failed to get allowance for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Check if token has sufficient allowance
   */
  async hasSufficientAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
    requiredAmount: string
  ): Promise<boolean> {
    try {
      const allowanceInfo = await this.getTokenAllowance(tokenAddress, owner, spender);
      
      if (allowanceInfo.isUnlimited) {
        return true;
      }

      const required = parseFloat(requiredAmount);
      const allowed = parseFloat(allowanceInfo.formattedAllowance);

      const hasSufficient = allowed >= required;
      
      if (!hasSufficient) {
        logger.warn(`Insufficient token allowance:`);
        logger.warn(`  Token: ${tokenAddress}`);
        logger.warn(`  Owner: ${owner}`);
        logger.warn(`  Spender: ${spender}`);
        logger.warn(`  Required: ${required}`);
        logger.warn(`  Allowed: ${allowed}`);
      }

      return hasSufficient;
    } catch (error) {
      logger.error(`Failed to check token allowance:`, error);
      return false;
    }
  }

  /**
   * Check all requirements for a token swap
   */
  async checkSwapRequirements(
    walletAddress: string,
    tokenInAddress: string,
    amountIn: string,
    spenderAddress: string,
    gasEstimateEth?: string
  ): Promise<{
    hasTokenBalance: boolean;
    hasAllowance: boolean;
    hasGasBalance: boolean;
    canExecuteSwap: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      // Check token balance
      const hasTokenBalance = tokenInAddress === ethers.ZeroAddress
        ? await this.hasSufficientNativeBalance(walletAddress, amountIn)
        : await this.hasSufficientTokenBalance(walletAddress, tokenInAddress, amountIn);

      if (!hasTokenBalance) {
        errors.push('Insufficient token balance');
      }

      // Check allowance (skip for native token)
      let hasAllowance = true;
      if (tokenInAddress !== ethers.ZeroAddress) {
        hasAllowance = await this.hasSufficientAllowance(
          tokenInAddress,
          walletAddress,
          spenderAddress,
          amountIn
        );
        
        if (!hasAllowance) {
          errors.push('Insufficient token allowance');
        }
      }

      // Check gas balance
      let hasGasBalance = true;
      if (gasEstimateEth) {
        hasGasBalance = await this.hasSufficientNativeBalance(walletAddress, gasEstimateEth);
        
        if (!hasGasBalance) {
          errors.push('Insufficient gas balance');
        }
      }

      const canExecuteSwap = hasTokenBalance && hasAllowance && hasGasBalance;

      return {
        hasTokenBalance,
        hasAllowance,
        hasGasBalance,
        canExecuteSwap,
        errors
      };
    } catch (error) {
      logger.error('Failed to check swap requirements:', error);
      errors.push('Failed to check requirements');
      
      return {
        hasTokenBalance: false,
        hasAllowance: false,
        hasGasBalance: false,
        canExecuteSwap: false,
        errors
      };
    }
  }

  /**
   * Get balances for multiple wallets
   */
  async getMultipleWalletBalances(
    walletAddresses: string[],
    tokenAddresses: string[] = []
  ): Promise<WalletBalances[]> {
    const balancePromises = walletAddresses.map(address =>
      this.getWalletBalances(address, tokenAddresses)
    );

    try {
      const results = await Promise.allSettled(balancePromises);
      
      return results
        .filter((result): result is PromiseFulfilledResult<WalletBalances> => 
          result.status === 'fulfilled'
        )
        .map(result => result.value);
    } catch (error) {
      logger.error('Failed to get multiple wallet balances:', error);
      throw error;
    }
  }

  /**
   * Clear cache for specific wallet or all wallets
   */
  clearCache(walletAddress?: string): void {
    if (walletAddress) {
      this.balanceCache.delete(walletAddress.toLowerCase());
      logger.debug(`Cleared balance cache for ${walletAddress}`);
    } else {
      this.balanceCache.clear();
      logger.debug('Cleared all balance cache');
    }
  }

  /**
   * Clear token info cache
   */
  clearTokenInfoCache(tokenAddress?: string): void {
    if (tokenAddress) {
      this.tokenInfoCache.delete(tokenAddress.toLowerCase());
      logger.debug(`Cleared token info cache for ${tokenAddress}`);
    } else {
      this.tokenInfoCache.clear();
      logger.debug('Cleared all token info cache');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    balanceCacheSize: number;
    tokenInfoCacheSize: number;
    oldestBalanceCache?: number;
    newestBalanceCache?: number;
  } {
    let oldestCache: number | undefined;
    let newestCache: number | undefined;

    for (const balance of this.balanceCache.values()) {
      if (!oldestCache || balance.lastUpdated < oldestCache) {
        oldestCache = balance.lastUpdated;
      }
      if (!newestCache || balance.lastUpdated > newestCache) {
        newestCache = balance.lastUpdated;
      }
    }

    return {
      balanceCacheSize: this.balanceCache.size,
      tokenInfoCacheSize: this.tokenInfoCache.size,
      oldestBalanceCache: oldestCache,
      newestBalanceCache: newestCache
    };
  }

  /**
   * Cleanup old cache entries
   */
  cleanupCache(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [address, balance] of this.balanceCache.entries()) {
      if (now - balance.lastUpdated > this.CACHE_DURATION * 5) { // 5x cache duration
        this.balanceCache.delete(address);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old balance cache entries`);
    }

    return cleanedCount;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test with a zero address query (should not fail)
      await this.provider.getBalance(ethers.ZeroAddress);
      return true;
    } catch (error) {
      logger.error('BalanceService health check failed:', error);
      return false;
    }
  }
}

export default BalanceService;