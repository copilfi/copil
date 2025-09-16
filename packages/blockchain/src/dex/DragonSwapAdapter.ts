import { ethers, Contract } from 'ethers';
import { BaseDexAdapter, DexConfig } from './BaseDexAdapter';
import type { SwapParams } from '../types';
import { SeiProvider } from '../providers/SeiProvider';

// DragonSwap contract ABIs (similar to Uniswap V2)
const DRAGONSWAP_ROUTER_ABI = [
  {
    "type": "function",
    "name": "swapExactTokensForTokens",
    "inputs": [
      {"name": "amountIn", "type": "uint256"},
      {"name": "amountOutMin", "type": "uint256"},
      {"name": "path", "type": "address[]"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swapTokensForExactTokens",
    "inputs": [
      {"name": "amountOut", "type": "uint256"},
      {"name": "amountInMax", "type": "uint256"},
      {"name": "path", "type": "address[]"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swapExactETHForTokens",
    "inputs": [
      {"name": "amountOutMin", "type": "uint256"},
      {"name": "path", "type": "address[]"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "swapTokensForExactETH",
    "inputs": [
      {"name": "amountOut", "type": "uint256"},
      {"name": "amountInMax", "type": "uint256"},
      {"name": "path", "type": "address[]"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAmountsOut",
    "inputs": [
      {"name": "amountIn", "type": "uint256"},
      {"name": "path", "type": "address[]"}
    ],
    "outputs": [{"name": "amounts", "type": "uint256[]"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "addLiquidity",
    "inputs": [
      {"name": "tokenA", "type": "address"},
      {"name": "tokenB", "type": "address"},
      {"name": "amountADesired", "type": "uint256"},
      {"name": "amountBDesired", "type": "uint256"},
      {"name": "amountAMin", "type": "uint256"},
      {"name": "amountBMin", "type": "uint256"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [
      {"name": "amountA", "type": "uint256"},
      {"name": "amountB", "type": "uint256"},
      {"name": "liquidity", "type": "uint256"}
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "removeLiquidity",
    "inputs": [
      {"name": "tokenA", "type": "address"},
      {"name": "tokenB", "type": "address"},
      {"name": "liquidity", "type": "uint256"},
      {"name": "amountAMin", "type": "uint256"},
      {"name": "amountBMin", "type": "uint256"},
      {"name": "to", "type": "address"},
      {"name": "deadline", "type": "uint256"}
    ],
    "outputs": [
      {"name": "amountA", "type": "uint256"},
      {"name": "amountB", "type": "uint256"}
    ],
    "stateMutability": "nonpayable"
  }
];

const DRAGONSWAP_FACTORY_ABI = [
  {
    "type": "function",
    "name": "getPair",
    "inputs": [
      {"name": "tokenA", "type": "address"},
      {"name": "tokenB", "type": "address"}
    ],
    "outputs": [{"name": "pair", "type": "address"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createPair",
    "inputs": [
      {"name": "tokenA", "type": "address"},
      {"name": "tokenB", "type": "address"}
    ],
    "outputs": [{"name": "pair", "type": "address"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allPairs",
    "inputs": [{"name": "index", "type": "uint256"}],
    "outputs": [{"name": "pair", "type": "address"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allPairsLength",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  }
];

const DRAGONSWAP_PAIR_ABI = [
  {
    "type": "function",
    "name": "getReserves",
    "inputs": [],
    "outputs": [
      {"name": "_reserve0", "type": "uint112"},
      {"name": "_reserve1", "type": "uint112"},
      {"name": "_blockTimestampLast", "type": "uint32"}
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
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
  },
  {
    "type": "function",
    "name": "price0CumulativeLast",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "price1CumulativeLast",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  }
];

export class DragonSwapAdapter extends BaseDexAdapter {
  private static cachedAddresses: { router?: string; factory?: string } = {};

  constructor(provider: SeiProvider) {
    const config: DexConfig = {
      name: 'DragonSwap',
      routerAddress: DragonSwapAdapter.cachedAddresses.router || '0x0000000000000000000000000000000000000000', // Will be resolved dynamically
      factoryAddress: DragonSwapAdapter.cachedAddresses.factory || '0x0000000000000000000000000000000000000000', // Will be resolved dynamically
      wethAddress: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7', // Real WSEI address on SEI mainnet
      fee: 30, // 0.30% fee (standard Uniswap V2 fork fee)
      version: 'v2'
    };

    super(config, provider);
    this.initializeContractAddresses();
  }

  private async initializeContractAddresses(): Promise<void> {
    try {
      // If addresses are already cached, no need to resolve again
      if (DragonSwapAdapter.cachedAddresses.router && DragonSwapAdapter.cachedAddresses.factory) {
        this.config.routerAddress = DragonSwapAdapter.cachedAddresses.router;
        this.config.factoryAddress = DragonSwapAdapter.cachedAddresses.factory;
        return;
      }

      // Try to discover DragonSwap addresses by looking for known patterns
      const discoveredAddresses = await this.discoverDragonSwapAddresses();
      
      if (discoveredAddresses.router && discoveredAddresses.factory) {
        DragonSwapAdapter.cachedAddresses = discoveredAddresses;
        this.config.routerAddress = discoveredAddresses.router;
        this.config.factoryAddress = discoveredAddresses.factory;
        
        console.log('🐉 DragonSwap addresses discovered:', discoveredAddresses);
      } else {
        console.warn('⚠️  Could not auto-discover DragonSwap addresses. Using fallback detection.');
        // Use known addresses from research or fallback
        await this.tryKnownAddresses();
      }
    } catch (error: unknown) {
      console.error('Failed to initialize DragonSwap addresses:', error);
      // Use fallback addresses
      await this.tryKnownAddresses();
    }
  }

  private async discoverDragonSwapAddresses(): Promise<{ router?: string; factory?: string }> {
    const evmProvider = this.provider.getEvmProvider();
    
    // Known potential addresses from research
    const potentialAddresses = [
      '0x5B8203E65AA5BE3F1CF53FD7FA21B91BA4038ECC',
      '0x5CF6826140C1C56FF49C808A1A75407CD1DF9423',  
      '0x5F0E07DFEE5832FAA00C63F2D33A0D79150E8598',
      '0xB75D0B03C06A926E488E2659DF1A861F860BD3D1'
    ];

    for (const address of potentialAddresses) {
      try {
        // Try to call router-specific functions to identify router
        const contract = new Contract(address, DRAGONSWAP_ROUTER_ABI, evmProvider);
        const factory = await contract.factory();
        
        if (factory && factory !== '0x0000000000000000000000000000000000000000') {
          return { router: address, factory };
        }
      } catch (error: unknown) {
        // Not a router contract, continue
        continue;
      }
    }

    return {};
  }

  private async tryKnownAddresses(): Promise<void> {
    // Fallback addresses - these might need to be updated based on actual deployment
    const fallbackRouter = '0x5B8203E65AA5BE3F1CF53FD7FA21B91BA4038ECC'; // Estimated
    const fallbackFactory = '0x5CF6826140C1C56FF49C808A1A75407CD1DF9423'; // Estimated
    
    try {
      // Test if these addresses have router-like functionality
      const routerContract = new Contract(fallbackRouter, DRAGONSWAP_ROUTER_ABI, this.provider.getEvmProvider());
      const factory = await routerContract.factory();
      
      if (factory) {
        DragonSwapAdapter.cachedAddresses = { 
          router: fallbackRouter, 
          factory 
        };
        this.config.routerAddress = fallbackRouter;
        this.config.factoryAddress = factory;
        
        console.log('🐉 Using fallback DragonSwap addresses:', { router: fallbackRouter, factory });
      }
    } catch (error: unknown) {
      console.warn('⚠️  Fallback addresses also failed. DragonSwap may not be available.');
    }
  }

  protected createRouterContract(): Contract {
    return new Contract(
      this.config.routerAddress,
      DRAGONSWAP_ROUTER_ABI,
      this.provider.getEvmProvider()
    );
  }

  protected createFactoryContract(): Contract {
    return new Contract(
      this.config.factoryAddress,
      DRAGONSWAP_FACTORY_ABI,
      this.provider.getEvmProvider()
    );
  }

  protected createQuoterContract(): Contract {
    // DragonSwap V2 uses router for quotes
    return this.router;
  }

  protected buildSwapCalldata(params: SwapParams): string {
    if (this.isNativeToken(params.tokenIn)) {
      // ETH to Token swap
      const path = [this.config.wethAddress, params.tokenOut];
      return this.router.interface.encodeFunctionData('swapExactETHForTokens', [
        params.amountOutMin,
        path,
        params.recipient,
        params.deadline
      ]);
    } else if (this.isNativeToken(params.tokenOut)) {
      // Token to ETH swap
      const path = [params.tokenIn, this.config.wethAddress];
      return this.router.interface.encodeFunctionData('swapTokensForExactETH', [
        params.amountOutMin,
        ethers.MaxUint256, // Use max as amountInMax for exact output
        path,
        params.recipient,
        params.deadline
      ]);
    } else {
      // Token to Token swap
      const path = [params.tokenIn, params.tokenOut];
      return this.router.interface.encodeFunctionData('swapExactTokensForTokens', [
        params.amountIn,
        params.amountOutMin,
        path,
        params.recipient,
        params.deadline
      ]);
    }
  }

  protected getPoolABI(): any[] {
    return DRAGONSWAP_PAIR_ABI;
  }

  protected async getReserve(poolContract: Contract, index: number): Promise<string> {
    const reserves = await poolContract.getReserves();
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

    return this.router.interface.encodeFunctionData('addLiquidity', [
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

    return this.router.interface.encodeFunctionData('removeLiquidity', [
      token0,
      token1,
      liquidity,
      '0', // Min amount0 - should be calculated based on slippage
      '0', // Min amount1 - should be calculated based on slippage
      recipientAddress,
      deadline
    ]);
  }

  // DragonSwap-specific methods
  
  /**
   * Get all pairs in the factory
   */
  async getAllPairs(): Promise<string[]> {
    if (!this.factory) {
      throw new Error('Factory not initialized');
    }

    const pairsLength = await this.factory.allPairsLength();
    const pairs: string[] = [];

    for (let i = 0; i < pairsLength; i++) {
      const pairAddress = await this.factory.allPairs(i);
      pairs.push(pairAddress);
    }

    return pairs;
  }

  /**
   * Get price cumulative data for time-weighted average price
   */
  async getPriceCumulativeData(token0: string, token1: string): Promise<{
    price0CumulativeLast: string;
    price1CumulativeLast: string;
    blockTimestampLast: number;
  }> {
    const poolAddress = await this.getPoolAddress(token0, token1);
    const poolContract = new Contract(poolAddress, DRAGONSWAP_PAIR_ABI, this.provider.getEvmProvider());

    const [price0Cumulative, price1Cumulative, reserves] = await Promise.all([
      poolContract.price0CumulativeLast(),
      poolContract.price1CumulativeLast(),
      poolContract.getReserves()
    ]);

    return {
      price0CumulativeLast: price0Cumulative.toString(),
      price1CumulativeLast: price1Cumulative.toString(),
      blockTimestampLast: reserves[2] // _blockTimestampLast
    };
  }

  /**
   * Calculate time-weighted average price
   */
  async calculateTWAP(
    token0: string,
    token1: string,
    periodSeconds: number
  ): Promise<{
    price0: string;
    price1: string;
  }> {
    const currentData = await this.getPriceCumulativeData(token0, token1);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    
    // This is simplified - in practice, you'd need historical data
    // For a proper TWAP, you'd store previous cumulative prices and timestamps
    
    return {
      price0: '0', // Placeholder - needs historical data
      price1: '0'  // Placeholder - needs historical data
    };
  }

  /**
   * Get optimal swap amounts for balanced liquidity provision
   */
  async calculateOptimalSwapAmount(
    token0: string,
    token1: string,
    amount0: string,
    amount1: string
  ): Promise<{
    swapAmount: string;
    swapFrom: string;
    swapTo: string;
    finalAmount0: string;
    finalAmount1: string;
  }> {
    const poolInfo = await this.getPoolInfo(token0, token1);
    const reserve0 = BigInt(poolInfo.reserve0);
    const reserve1 = BigInt(poolInfo.reserve1);
    
    if (reserve0 === BigInt(0) || reserve1 === BigInt(0)) {
      // New pool, no swap needed
      return {
        swapAmount: '0',
        swapFrom: token0,
        swapTo: token1,
        finalAmount0: amount0,
        finalAmount1: amount1
      };
    }

    const amount0Bn = BigInt(amount0);
    const amount1Bn = BigInt(amount1);
    
    // Calculate optimal ratio
    const optimalRatio = reserve1 * BigInt(1e18) / reserve0;
    const currentRatio = amount1Bn * BigInt(1e18) / amount0Bn;
    
    if (currentRatio > optimalRatio) {
      // Too much token1, swap some to token0
      const excessToken1 = (amount1Bn * BigInt(1e18) / optimalRatio - amount0Bn) * optimalRatio / (BigInt(1e18) + optimalRatio);
      
      return {
        swapAmount: excessToken1.toString(),
        swapFrom: token1,
        swapTo: token0,
        finalAmount0: amount0, // Will be updated after swap
        finalAmount1: (amount1Bn - excessToken1).toString()
      };
    } else if (currentRatio < optimalRatio) {
      // Too much token0, swap some to token1
      const excessToken0 = (amount0Bn - amount1Bn * BigInt(1e18) / optimalRatio) / (BigInt(1) + BigInt(1e18) / optimalRatio);
      
      return {
        swapAmount: excessToken0.toString(),
        swapFrom: token0,
        swapTo: token1,
        finalAmount0: (amount0Bn - excessToken0).toString(),
        finalAmount1: amount1 // Will be updated after swap
      };
    }
    
    // Already balanced
    return {
      swapAmount: '0',
      swapFrom: token0,
      swapTo: token1,
      finalAmount0: amount0,
      finalAmount1: amount1
    };
  }

  /**
   * Get impermanent loss calculation
   */
  async calculateImpermanentLoss(
    token0: string,
    token1: string,
    initialPrice0: string,
    initialPrice1: string
  ): Promise<{
    impermanentLossPercent: number;
    hodlValue: string;
    lpValue: string;
  }> {
    const poolInfo = await this.getPoolInfo(token0, token1);
    const currentPrice0 = poolInfo.price;
    
    const initialPriceRatio = BigInt(initialPrice1) * BigInt(1e18) / BigInt(initialPrice0);
    const currentPriceRatio = BigInt(currentPrice0);
    
    if (initialPriceRatio === BigInt(0)) {
      return {
        impermanentLossPercent: 0,
        hodlValue: '0',
        lpValue: '0'
      };
    }
    
    const priceChange = currentPriceRatio * BigInt(100) / initialPriceRatio;
    
    // Simplified IL calculation
    // IL = 2 * sqrt(price_ratio) / (1 + price_ratio) - 1
    const priceChangeNumber = Number(priceChange) / 100;
    const sqrtPriceChange = Math.sqrt(priceChangeNumber);
    const impermanentLoss = (2 * sqrtPriceChange) / (1 + priceChangeNumber) - 1;
    
    return {
      impermanentLossPercent: impermanentLoss * 100,
      hodlValue: '0', // Would need initial amounts to calculate
      lpValue: '0'    // Would need initial amounts to calculate
    };
  }

  /**
   * Get farming rewards if DragonSwap has yield farming
   */
  async getFarmingRewards(poolAddress: string, userAddress: string): Promise<{
    pendingRewards: string;
    rewardToken: string;
    apr: number;
  }> {
    // This would interact with DragonSwap's farming contracts
    // Placeholder implementation
    return {
      pendingRewards: '0',
      rewardToken: '0x...', // DRAGON token or similar
      apr: 0
    };
  }
}