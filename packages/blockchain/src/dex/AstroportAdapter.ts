import { ethers, Contract } from 'ethers';
import { BaseDexAdapter, DexConfig } from './BaseDexAdapter';
import type { SwapParams } from '../types';
import { SeiProvider } from '../providers/SeiProvider';

// Astroport contract ABIs
const ASTROPORT_ROUTER_ABI = [
  {
    "type": "function",
    "name": "swap_exact_tokens_for_tokens",
    "inputs": [
      {"name": "amount_in", "type": "uint256"},
      {"name": "amount_out_min", "type": "uint256"},
      {"name": "path", "type": "address[]"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swap_tokens_for_exact_tokens",
    "inputs": [
      {"name": "amount_out", "type": "uint256"},
      {"name": "amount_in_max", "type": "uint256"},
      {"name": "path", "type": "address[]"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "get_amounts_out",
    "inputs": [
      {"name": "amount_in", "type": "uint256"},
      {"name": "path", "type": "address[]"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "add_liquidity",
    "inputs": [
      {"name": "token_a", "type": "address"},
      {"name": "token_b", "type": "address"},
      {"name": "amount_a_desired", "type": "uint256"},
      {"name": "amount_b_desired", "type": "uint256"},
      {"name": "amount_a_min", "type": "uint256"},
      {"name": "amount_b_min", "type": "uint256"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [
      {"name": "amount_a", "type": "uint256"},
      {"name": "amount_b", "type": "uint256"},
      {"name": "liquidity", "type": "uint256"}
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "remove_liquidity",
    "inputs": [
      {"name": "token_a", "type": "address"},
      {"name": "token_b", "type": "address"},
      {"name": "liquidity", "type": "uint256"},
      {"name": "amount_a_min", "type": "uint256"},
      {"name": "amount_b_min", "type": "uint256"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [
      {"name": "amount_a", "type": "uint256"},
      {"name": "amount_b", "type": "uint256"}
    ],
    "stateMutability": "nonpayable"
  }
];

const ASTROPORT_FACTORY_ABI = [
  {
    "type": "function",
    "name": "pair",
    "inputs": [
      {"name": "token_a", "type": "address"},
      {"name": "token_b", "type": "address"}
    ],
    "outputs": [{"name": "pair", "type": "address"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "create_pair",
    "inputs": [
      {"name": "token_a", "type": "address"},
      {"name": "token_b", "type": "address"}
    ],
    "outputs": [{"name": "pair", "type": "address"}],
    "stateMutability": "nonpayable"
  }
];

const ASTROPORT_PAIR_ABI = [
  {
    "type": "function",
    "name": "get_reserves",
    "inputs": [],
    "outputs": [
      {"name": "reserve0", "type": "uint256"},
      {"name": "reserve1", "type": "uint256"},
      {"name": "block_timestamp_last", "type": "uint32"}
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "total_supply",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token0",
    "inputs": [],
    "outputs": [{"name": "", "type": "address"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token1",
    "inputs": [],
    "outputs": [{"name": "", "type": "address"}],
    "stateMutability": "view"
  }
];

export class AstroportAdapter extends BaseDexAdapter {
  constructor(provider: SeiProvider) {
    const config: DexConfig = {
      name: 'Astroport',
      routerAddress: '0x...', // Astroport Router address on Sei
      factoryAddress: '0x...', // Astroport Factory address on Sei
      wethAddress: '0x...', // WSEI address
      fee: 30, // 0.3% fee
      version: 'v2'
    };

    super(config, provider);
  }

  protected createRouterContract(): Contract {
    return new Contract(
      this.config.routerAddress,
      ASTROPORT_ROUTER_ABI,
      this.provider.getEvmProvider()
    );
  }

  protected createFactoryContract(): Contract {
    return new Contract(
      this.config.factoryAddress,
      ASTROPORT_FACTORY_ABI,
      this.provider.getEvmProvider()
    );
  }

  protected createQuoterContract(): Contract {
    // Astroport v2 doesn't have a separate quoter contract
    // Quotes are handled by the router
    return this.router;
  }

  protected buildSwapCalldata(params: SwapParams): string {
    const route = [params.tokenIn, params.tokenOut];
    
    return this.router.interface.encodeFunctionData('swap_exact_tokens_for_tokens', [
      params.amountIn,
      params.amountOutMin,
      route,
      params.recipient,
      params.deadline
    ]);
  }

  protected getPoolABI(): any[] {
    return ASTROPORT_PAIR_ABI;
  }

  protected async getReserve(poolContract: Contract, index: number): Promise<string> {
    const reserves = await poolContract.get_reserves();
    return reserves[index].toString();
  }

  protected async buildAddLiquidityCalldata(
    token0: string,
    token1: string,
    amount0: string,
    amount1: string,
    signerAddress?: string
  ): Promise<string> {
    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes
    const amountMin0 = BigInt(amount0) * BigInt(95) / BigInt(100); // 5% slippage
    const amountMin1 = BigInt(amount1) * BigInt(95) / BigInt(100);

    let recipientAddress = signerAddress;
    if (!recipientAddress) {
      const signer = await this.provider.getEvmProvider().getSigner?.();
      recipientAddress = signer ? await signer.getAddress() : '';
    }

    return this.router.interface.encodeFunctionData('add_liquidity', [
      token0,
      token1,
      amount0,
      amount1,
      amountMin0.toString(),
      amountMin1.toString(),
      recipientAddress,
      deadline
    ]);
  }

  protected async buildRemoveLiquidityCalldata(
    token0: string,
    token1: string,
    liquidity: string,
    signerAddress?: string
  ): Promise<string> {
    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

    let recipientAddress = signerAddress;
    if (!recipientAddress) {
      const signer = await this.provider.getEvmProvider().getSigner?.();
      recipientAddress = signer ? await signer.getAddress() : '';
    }

    return this.router.interface.encodeFunctionData('remove_liquidity', [
      token0,
      token1,
      liquidity,
      '0', // Min amount0 - should be calculated based on slippage
      '0', // Min amount1 - should be calculated based on slippage
      recipientAddress,
      deadline
    ]);
  }

  // Astroport-specific methods
  async getPoolFee(token0: string, token1: string): Promise<number> {
    // Astroport has different fee tiers for different pools
    const poolAddress = await this.getPoolAddress(token0, token1);
    
    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
      return this.config.fee;
    }

    try {
      // If the pool has a fee method, call it
      const poolContract = new Contract(poolAddress, ASTROPORT_PAIR_ABI, this.provider.getEvmProvider());
      // Most Astroport pools have 0.3% fee, but some might be different
      return this.config.fee;
    } catch {
      return this.config.fee;
    }
  }

  /**
   * Get pool assets info (for Astroport's asset-based structure)
   */
  async getPoolAssets(poolAddress: string): Promise<{
    asset0: { token: string; amount: string };
    asset1: { token: string; amount: string };
  }> {
    const poolContract = new Contract(poolAddress, ASTROPORT_PAIR_ABI, this.provider.getEvmProvider());
    
    const [token0, token1, reserves] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
      poolContract.get_reserves()
    ]);

    return {
      asset0: {
        token: token0,
        amount: reserves[0].toString()
      },
      asset1: {
        token: token1,
        amount: reserves[1].toString()
      }
    };
  }

  /**
   * Get Astroport pool type (XYK, Stable, etc.)
   */
  async getPoolType(poolAddress: string): Promise<'xyk' | 'stable' | 'concentrated'> {
    // This would need to be determined based on the pool contract
    // For now, assume XYK (constant product) pools
    return 'xyk';
  }

  /**
   * Calculate optimal swap route through multiple pools
   */
  async findOptimalRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<{
    path: string[];
    expectedAmountOut: string;
    priceImpact: number;
  }> {
    // Try direct route first
    const directRoute = [tokenIn, tokenOut];
    try {
      const directAmountOut = await this.getAmountsOut(amountIn, directRoute);
      const directPriceImpact = await this.calculatePriceImpact(tokenIn, tokenOut, amountIn, directAmountOut);
      
      return {
        path: directRoute,
        expectedAmountOut: directAmountOut,
        priceImpact: directPriceImpact
      };
    } catch (directError) {
      // Try multi-hop routes if direct fails
      const multiHopRoutes = await this.findMultiHopRoutes(tokenIn, tokenOut);
      
      let bestRoute = { path: directRoute, expectedAmountOut: '0', priceImpact: 100 };
      
      for (const route of multiHopRoutes) {
        try {
          const amountOut = await this.getAmountsOut(amountIn, route);
          const priceImpact = await this.calculatePriceImpact(tokenIn, tokenOut, amountIn, amountOut);
          
          if (BigInt(amountOut) > BigInt(bestRoute.expectedAmountOut)) {
            bestRoute = {
              path: route,
              expectedAmountOut: amountOut,
              priceImpact
            };
          }
        } catch (routeError) {
          continue; // Try next route
        }
      }
      
      return bestRoute;
    }
  }

  /**
   * Find possible multi-hop routes
   */
  private async findMultiHopRoutes(tokenIn: string, tokenOut: string): Promise<string[][]> {
    // Common intermediate tokens on Sei/Astroport
    const intermediateTokens = [
      this.config.wethAddress, // WSEI
      '0x...', // USDC
      '0x...', // USDT
      // Add more popular tokens
    ];

    const routes: string[][] = [];
    
    for (const intermediate of intermediateTokens) {
      if (intermediate !== tokenIn && intermediate !== tokenOut) {
        routes.push([tokenIn, intermediate, tokenOut]);
      }
    }
    
    return routes;
  }

  /**
   * Get current epoch for staking rewards (if applicable)
   */
  async getCurrentEpoch(): Promise<number> {
    // This would interact with Astroport's generator contract for staking
    return 0; // Placeholder
  }

  /**
   * Get staking rewards for a pool
   */
  async getPoolRewards(poolAddress: string): Promise<{
    token: string;
    amount: string;
    apr: number;
  }[]> {
    // This would fetch rewards from Astroport's generator contract
    return []; // Placeholder
  }
}