import { Address, PublicClient, WalletClient, formatUnits } from 'viem';
import { SYMPHONY_CONFIG, DEFAULT_DEADLINE_MINUTES, DEFAULT_SLIPPAGE_TOLERANCE } from '../common/constants';
import { SwapParams, SwapResult } from '../common/types';
import { ERC20_ABI } from '../dragonswap/abi';
import { BlockchainLogger } from '../../utils/Logger';
import { Validator } from '../../utils/Validator';

interface SymphonySwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  recipient: Address;
  deadline: number;
}

export class SymphonyProvider {
  private logger = BlockchainLogger.getInstance();

  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient
  ) {
    this.validateClients();
  }

  private validateClients(): void {
    if (!this.publicClient) {
      throw new Error('Public client is required');
    }
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('Wallet client with account is required');
    }
  }

  async getTokenBalance(tokenAddress: Address, accountAddress?: Address): Promise<bigint> {
    const account = accountAddress || this.walletClient.account!.address;
    
    try {
      const balance = await this.publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account]
      });
      
      return balance as bigint;
    } catch (error) {
      this.logger.error(`Failed to get token balance for ${tokenAddress}, account: ${account}`);
      throw new Error(`Failed to get token balance: ${error}`);
    }
  }

  private async approveToken(tokenAddress: Address, spenderAddress: Address, amount: bigint): Promise<void> {
    try {
      // Check current allowance
      const currentAllowance = await this.publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [this.walletClient.account!.address, spenderAddress]
      });

      if ((currentAllowance as bigint) >= amount) {
        this.logger.info('Token already approved', { tokenAddress, spenderAddress, amount });
        return;
      }

      // Approve token spending
      const hash = await this.walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spenderAddress, amount],
        account: this.walletClient.account!,
        chain: this.walletClient.chain
      });

      this.logger.info('Token approval initiated', { hash, tokenAddress, spenderAddress, amount });

      // Wait for approval transaction
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      
      if (receipt.status !== 'success') {
        throw new Error('Token approval failed');
      }

      this.logger.info('Token approval completed', { hash, tokenAddress, spenderAddress, amount });
    } catch (error) {
      this.logger.error(`Token approval failed: ${tokenAddress} -> ${spenderAddress}, amount: ${amount}`);
      throw new Error(`Token approval failed: ${error}`);
    }
  }

  async getSwapQuote(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
  }): Promise<{
    amountOut: bigint;
    route: Address[];
    priceImpact: number;
  }> {
    this.logger.info('Getting swap quote from Symphony aggregator', { params });

    try {
      // Try to call Symphony's actual quoter if available
      const symphonyQuoterAbi = [
        {
          type: "function",
          name: "getAmountsOut",
          stateMutability: "view",
          inputs: [
            { name: "amountIn", type: "uint256" },
            { name: "path", type: "address[]" }
          ],
          outputs: [{ name: "amounts", type: "uint256[]" }]
        }
      ] as const;

      try {
        // Attempt to get real quote from Symphony quoter
        const amounts = await this.publicClient.readContract({
          address: SYMPHONY_CONFIG.quoterAddress || SYMPHONY_CONFIG.routerAddress,
          abi: symphonyQuoterAbi,
          functionName: 'getAmountsOut',
          args: [params.amountIn, [params.tokenIn, params.tokenOut]]
        }) as bigint[];

        const amountOut = amounts[amounts.length - 1];
        const priceImpact = this.calculatePriceImpact(params.amountIn, amountOut);

        return {
          amountOut,
          route: [params.tokenIn, params.tokenOut],
          priceImpact
        };
      } catch (quoterError) {
        this.logger.warn('Symphony quoter not available, using fallback calculation', {
          error: quoterError instanceof Error ? quoterError.message : 'Unknown error'
        });
        
        // Fallback: Use standard AMM formula with 0.3% fee
        const estimatedAmountOut = params.amountIn * 997n / 1000n;
        
        return {
          amountOut: estimatedAmountOut,
          route: [params.tokenIn, params.tokenOut],
          priceImpact: 0.003 // 0.3% fee assumption
        };
      }
    } catch (error) {
      this.logger.error('Failed to get Symphony quote', undefined, { params });
      throw new Error(`Failed to get Symphony quote: ${error}`);
    }
  }

  private calculatePriceImpact(amountIn: bigint, amountOut: bigint): number {
    // Calculate price impact based on input/output ratio
    if (amountIn === 0n) return 0;
    
    const ratio = Number(amountOut) / Number(amountIn);
    // Assume 1:1 price for simplicity, calculate deviation from expected
    const expectedRatio = 0.997; // Account for 0.3% fee
    const impact = Math.abs(ratio - expectedRatio) / expectedRatio;
    
    return Math.min(impact, 0.15); // Cap at 15% impact
  }

  async swap(params: SwapParams): Promise<SwapResult> {
    // Validation
    Validator.validateAddress(params.tokenIn);
    Validator.validateAddress(params.tokenOut);
    Validator.validateAmount(params.amountIn.toString());

    const recipient = params.recipient || this.walletClient.account!.address;
    const deadline = params.deadline || Math.floor(Date.now() / 1000) + (DEFAULT_DEADLINE_MINUTES * 60);
    
    this.logger.info('Starting Symphony swap', { params, recipient, deadline });

    try {
      // Check balance
      const balance = await this.getTokenBalance(params.tokenIn);
      if (balance < params.amountIn) {
        throw new Error(`Insufficient balance. Have: ${formatUnits(balance, 18)}, Need: ${formatUnits(params.amountIn, 18)}`);
      }

      // Get quote
      const quote = await this.getSwapQuote({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn
      });

      // Calculate minimum output with slippage
      const amountOutMinimum = params.amountOutMinimum || 
        (quote.amountOut * BigInt(Math.floor((1 - DEFAULT_SLIPPAGE_TOLERANCE) * 1000))) / 1000n;

      // Approve token spending
      await this.approveToken(params.tokenIn, SYMPHONY_CONFIG.routerAddress, params.amountIn);

      // Try different Symphony ABI patterns - they may use standard Uniswap V2 interface
      const symphonySwapAbi = [
        {
          type: "function",
          name: "swapExactTokensForTokens",
          stateMutability: "nonpayable",
          inputs: [
            { name: "amountIn", type: "uint256" },
            { name: "amountOutMin", type: "uint256" },
            { name: "path", type: "address[]" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" }
          ],
          outputs: [{ name: "amounts", type: "uint256[]" }]
        }
      ] as const;

      // Execute swap using standard Uniswap V2 interface
      const hash = await this.walletClient.writeContract({
        address: SYMPHONY_CONFIG.routerAddress,
        abi: symphonySwapAbi,
        functionName: 'swapExactTokensForTokens',
        args: [
          params.amountIn,
          amountOutMinimum,
          [params.tokenIn, params.tokenOut],
          recipient,
          BigInt(deadline)
        ],
        account: this.walletClient.account!,
        chain: this.walletClient.chain
      });

      this.logger.info('Swap transaction sent', { hash, params });

      // Wait for transaction
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      
      if (receipt.status !== 'success') {
        throw new Error('Swap transaction failed');
      }

      const result: SwapResult = {
        hash,
        amountIn: params.amountIn,
        amountOut: quote.amountOut,
        gasUsed: receipt.gasUsed
      };

      this.logger.info('Symphony swap completed successfully', { result });
      return result;

    } catch (error) {
      this.logger.error('Symphony swap failed', undefined, { params });
      throw new Error(`Symphony swap failed: ${error}`);
    }
  }

  async getBestRoute(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
  }): Promise<{
    route: Address[];
    expectedAmountOut: bigint;
    priceImpact: number;
    gasEstimate: bigint;
  }> {
    this.logger.info('Finding best route via Symphony aggregator', { params });

    try {
      // This would call Symphony's route optimization
      // For now, return a simplified response
      const quote = await this.getSwapQuote(params);
      
      return {
        route: quote.route,
        expectedAmountOut: quote.amountOut,
        priceImpact: quote.priceImpact,
        gasEstimate: 150000n // Estimated gas for swap
      };
    } catch (error) {
      this.logger.error('Failed to get best route', undefined, { params });
      throw new Error(`Failed to get best route: ${error}`);
    }
  }
}