import { Address, PublicClient, WalletClient, parseEther, formatUnits } from 'viem';
import { DRAGONSWAP_CONFIG, DEFAULT_DEADLINE_MINUTES, DEFAULT_SLIPPAGE_TOLERANCE } from '../common/constants';
import { SwapParams, ExactInputSingleParams, ExactOutputSingleParams, SwapResult, TokenInfo } from '../common/types';
import { DRAGONSWAP_ROUTER_ABI, DRAGONSWAP_QUOTER_ABI, ERC20_ABI } from './abi';
import { BlockchainLogger } from '../../utils/Logger';
import { Validator } from '../../utils/Validator';

export class DragonswapProvider {
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
    } catch (error: unknown) {
      this.logger.error(`Failed to get token balance for ${tokenAddress}, account: ${account}`);
      throw new Error(`Failed to get token balance: ${error}`);
    }
  }

  async getQuote(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    fee?: number;
  }): Promise<bigint> {
    const fee = params.fee || 3000; // Default 0.3% fee
    
    try {
      const quote = await this.publicClient.readContract({
        address: DRAGONSWAP_CONFIG.quoterAddress!,
        abi: DRAGONSWAP_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [params.tokenIn, params.tokenOut, fee, params.amountIn, 0n]
      });
      
      return quote as bigint;
    } catch (error: unknown) {
      this.logger.error('Failed to get quote', undefined, { params });
      throw new Error(`Failed to get quote: ${error}`);
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
    } catch (error: unknown) {
      this.logger.error(`Token approval failed: ${tokenAddress} -> ${spenderAddress}, amount: ${amount}`);
      throw new Error(`Token approval failed: ${error}`);
    }
  }

  async exactInputSingle(params: ExactInputSingleParams): Promise<SwapResult> {
    // Validation
    Validator.validateAddress(params.tokenIn);
    Validator.validateAddress(params.tokenOut);
    Validator.validateAmount(params.amountIn.toString());

    const recipient = params.recipient || this.walletClient.account!.address;
    const deadline = params.deadline || Math.floor(Date.now() / 1000) + (DEFAULT_DEADLINE_MINUTES * 60);
    const fee = params.fee || 3000;
    
    this.logger.info('Starting exact input single swap', { params, recipient, deadline });

    try {
      // Check balance
      const balance = await this.getTokenBalance(params.tokenIn);
      if (balance < params.amountIn) {
        throw new Error(`Insufficient balance. Have: ${formatUnits(balance, 18)}, Need: ${formatUnits(params.amountIn, 18)}`);
      }

      // Approve token spending
      await this.approveToken(params.tokenIn, DRAGONSWAP_CONFIG.routerAddress, params.amountIn);

      // Get quote for minimum output
      const estimatedAmountOut = await this.getQuote({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        fee
      });

      const amountOutMinimum = params.amountOutMinimum || 
        (estimatedAmountOut * BigInt(Math.floor((1 - DEFAULT_SLIPPAGE_TOLERANCE) * 1000))) / 1000n;

      // Execute swap
      const swapParams = {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee,
        recipient,
        amountIn: params.amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 || 0n,
      };

      const hash = await this.walletClient.writeContract({
        address: DRAGONSWAP_CONFIG.routerAddress,
        abi: DRAGONSWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [swapParams],
        account: this.walletClient.account!,
        chain: this.walletClient.chain
      });

      this.logger.info('Swap transaction sent', { hash, swapParams });

      // Wait for transaction
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      
      if (receipt.status !== 'success') {
        throw new Error('Swap transaction failed');
      }

      const result: SwapResult = {
        hash,
        amountIn: params.amountIn,
        amountOut: estimatedAmountOut, // This would be extracted from logs in real implementation
        gasUsed: receipt.gasUsed
      };

      this.logger.info('Swap completed successfully', { result });
      return result;

    } catch (error: unknown) {
      this.logger.error('Swap failed', undefined, { params });
      throw new Error(`Swap failed: ${error}`);
    }
  }

  async exactOutputSingle(params: ExactOutputSingleParams): Promise<SwapResult> {
    // Validation
    Validator.validateAddress(params.tokenIn);
    Validator.validateAddress(params.tokenOut);
    Validator.validateAmount(params.amountOut.toString());
    Validator.validateAmount(params.amountInMaximum.toString());

    const deadline = Math.floor(Date.now() / 1000) + (DEFAULT_DEADLINE_MINUTES * 60);
    const fee = params.fee || 3000;
    
    this.logger.info('Starting exact output single swap', { params, deadline });

    try {
      // Check balance
      const balance = await this.getTokenBalance(params.tokenIn);
      if (balance < params.amountInMaximum) {
        throw new Error(`Insufficient balance for maximum input. Have: ${formatUnits(balance, 18)}, Need: ${formatUnits(params.amountInMaximum, 18)}`);
      }

      // Approve token spending (maximum amount)
      await this.approveToken(params.tokenIn, DRAGONSWAP_CONFIG.routerAddress, params.amountInMaximum);

      // Execute swap
      const swapParams = {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee,
        recipient: params.recipient,
        amountOut: params.amountOut,
        amountInMaximum: params.amountInMaximum,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 || 0n,
      };

      const hash = await this.walletClient.writeContract({
        address: DRAGONSWAP_CONFIG.routerAddress,
        abi: DRAGONSWAP_ROUTER_ABI,
        functionName: 'exactOutputSingle',
        args: [swapParams],
        account: this.walletClient.account!,
        chain: this.walletClient.chain
      });

      this.logger.info('Swap transaction sent', { hash, swapParams });

      // Wait for transaction
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      
      if (receipt.status !== 'success') {
        throw new Error('Swap transaction failed');
      }

      const result: SwapResult = {
        hash,
        amountIn: params.amountInMaximum, // This would be the actual amount from logs
        amountOut: params.amountOut,
        gasUsed: receipt.gasUsed
      };

      this.logger.info('Swap completed successfully', { result });
      return result;

    } catch (error: unknown) {
      this.logger.error('Swap failed', undefined, { params });
      throw new Error(`Swap failed: ${error}`);
    }
  }
}