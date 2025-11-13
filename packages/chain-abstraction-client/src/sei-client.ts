import { createPublicClient, http, PublicClient, encodeFunctionData } from 'viem';
import { GetQuoteResponse, TransactionIntent, Quote, AssetBalance } from './types';
import { dragonswapRouterAbi } from './abis/dragonswap-router.abi';
import { seiChain } from './chains';

// A simple logger, in a real app this would be a proper NestJS logger injected.
const logger = {
    log: (...args: any[]) => console.log('[SeiClient]', ...args),
    error: (...args: any[]) => console.error('[SeiClient]', ...args),
};

const DRAGONSWAP_ROUTER_ADDRESS = '0x11da6463d6cb5a03411dbf5ab6f6bc3997ac7428';

export class SeiClient {
  private readonly client: PublicClient;

  constructor() {
    this.client = createPublicClient({
      chain: seiChain,
      transport: http(),
    });
  }

  async getBalance(address: `0x${string}`): Promise<AssetBalance[]> {
    logger.log(`Fetching balance for ${address} on Sei...`);
    try {
      const nativeBalance = await this.client.getBalance({
        address,
      });

      const nativeAsset: AssetBalance = {
        assetId: 'sei:native',
        symbol: 'SEI',
        name: 'Sei',
        amount: nativeBalance.toString(),
        amountUsd: '0',
      };

      // Note: Fungible token (CW20/ERC20) bakiye okuması gerektiğinde
      // bu.client.readContract ile uygun ERC-20 `balanceOf` çağrıları eklenebilir.

      return [nativeAsset];
    } catch (error) {
      logger.error(`Error fetching Sei balance for ${address}:`, error);
      throw new Error('Failed to fetch balance from Sei.');
    }
  }

  async getSwapQuote(intent: TransactionIntent): Promise<GetQuoteResponse> {
    logger.log('Getting Sei swap quote for intent:', intent);

    if (intent.type !== 'swap' && intent.type !== 'bridge') {
        throw new Error('SeiClient only supports swap/bridge intents');
    }

    // Default slippage tolerance: 1% (can be made configurable)
    const SLIPPAGE_BPS = 100; // 100 basis points = 1%

    // For Sei, we assume a single-hop swap on Dragonswap
    const simulationParams = {
        tokenIn: intent.fromToken as `0x${string}`,
        tokenOut: intent.toToken as `0x${string}`,
        fee: 3000, // Common fee tier, may need to be fetched dynamically
        recipient: intent.userAddress as `0x${string}`,
        amountIn: BigInt(intent.fromAmount),
        amountOutMinimum: 0n, // For simulation only, we can use 0
        sqrtPriceLimitX96: 0n, // No price limit for simulation
    };

    try {
      const { result } = await this.client.simulateContract({
        address: DRAGONSWAP_ROUTER_ADDRESS,
        abi: dragonswapRouterAbi,
        functionName: 'exactInputSingle',
        args: [simulationParams],
        account: intent.userAddress as `0x${string}`, // Needed for simulation context
      });

      const amountOut = BigInt(result.toString());

      // Calculate minimum amount out with slippage protection
      // amountOutMinimum = amountOut * (10000 - SLIPPAGE_BPS) / 10000
      const amountOutMinimum = (amountOut * BigInt(10000 - SLIPPAGE_BPS)) / BigInt(10000);

      // Prepare the transaction data for actual execution with slippage protection
      const executionParams = {
        ...simulationParams,
        amountOutMinimum, // Apply slippage protection for actual execution
      };

      const transactionRequest = {
        to: DRAGONSWAP_ROUTER_ADDRESS,
        data: encodeFunctionData({
            abi: dragonswapRouterAbi,
            functionName: 'exactInputSingle',
            args: [executionParams],
        }),
        value: '0', // Assuming no native SEI is sent with the swap itself
      };

      const quote: Quote = {
        id: `sei-dragonswap-${new Date().toISOString()}`,
        fromAmount: intent.fromAmount,
        toAmount: amountOut.toString(),
        transactionRequest,
      };

      return { quote };

    } catch (error) {
      logger.error('Error simulating Sei swap:', error);
      throw new Error('Failed to get quote from Sei DEX.');
    }
  }

  async getBridgeQuote(_intent: TransactionIntent): Promise<GetQuoteResponse> {
    throw new Error('Use AxelarBridgeClient for Sei bridge quotes.');
  }
}
