import { ethers, Contract } from 'ethers';
import type { 
  IDexAdapter,
  SwapParams,
  PoolInfo,
  PriceQuote
} from '../types';
import { ContractError, TransactionError } from '../types';
import { SeiProvider } from '../providers/SeiProvider';
import { ERC20_ABI } from '../constants/contracts';

export interface DexConfig {
  name: string;
  routerAddress: string;
  factoryAddress: string;
  quoterAddress?: string;
  wethAddress: string;
  fee: number; // Default fee in basis points
  version: 'v2' | 'v3';
}

export abstract class BaseDexAdapter implements IDexAdapter {
  protected provider: SeiProvider;
  protected router: Contract;
  protected factory?: Contract;
  protected quoter?: Contract;
  
  constructor(
    protected config: DexConfig,
    provider: SeiProvider
  ) {
    this.provider = provider;
    this.router = this.createRouterContract();
    
    if (config.factoryAddress) {
      this.factory = this.createFactoryContract();
    }
    
    if (config.quoterAddress) {
      this.quoter = this.createQuoterContract();
    }
  }

  get name(): string {
    return this.config.name;
  }

  // Abstract methods to be implemented by specific DEX adapters
  protected abstract createRouterContract(): Contract;
  protected abstract createFactoryContract(): Contract;
  protected abstract createQuoterContract(): Contract;
  protected abstract buildSwapCalldata(params: SwapParams): string;
  
  /**
   * Get price quote for a swap
   */
  async getQuote(params: SwapParams): Promise<PriceQuote> {
    try {
      const route = await this.findBestRoute(params.tokenIn, params.tokenOut);
      const amountOut = await this.getAmountsOut(params.amountIn, route);
      
      const priceImpact = await this.calculatePriceImpact(
        params.tokenIn,
        params.tokenOut,
        params.amountIn,
        amountOut
      );

      const executionPrice = this.calculateExecutionPrice(
        params.amountIn,
        amountOut,
        await this.getTokenDecimals(params.tokenIn),
        await this.getTokenDecimals(params.tokenOut)
      );

      const fee = this.calculateFee(params.amountIn);

      return {
        amountOut,
        priceImpact,
        executionPrice,
        fee,
        route
      };
    } catch (error: unknown) {
      throw new ContractError(
        `Failed to get quote for ${this.name}`,
        String(this.router.target),
        error
      );
    }
  }

  /**
   * Execute a swap
   */
  async executeSwap(params: SwapParams): Promise<any> {
    try {
      // Validate parameters
      this.validateSwapParams(params);
      
      // Check token approvals
      await this.ensureTokenApproval(params.tokenIn, params.amountIn, params.recipient);
      
      // Build swap transaction
      const calldata = this.buildSwapCalldata(params);
      
      // Estimate gas
      const gasEstimate = await this.provider.estimateGas({
        to: this.router.target as string,
        data: calldata,
        value: this.isNativeToken(params.tokenIn) ? params.amountIn : '0'
      });

      // Execute swap
      const tx = await this.provider.sendTransaction({
        to: this.router.target,
        data: calldata,
        gasLimit: gasEstimate,
        value: this.isNativeToken(params.tokenIn) ? params.amountIn : '0'
      });

      return tx;
    } catch (error: unknown) {
      throw new TransactionError(
        `Failed to execute swap on ${this.name}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get pool information
   */
  async getPoolInfo(token0: string, token1: string): Promise<PoolInfo> {
    try {
      const poolAddress = await this.getPoolAddress(token0, token1);
      
      if (!poolAddress || poolAddress === ethers.ZeroAddress) {
        throw new Error('Pool does not exist');
      }

      const poolContract = new Contract(poolAddress, this.getPoolABI(), this.provider.getEvmProvider());
      
      const [reserve0, reserve1, totalSupply] = await Promise.all([
        this.getReserve(poolContract, 0),
        this.getReserve(poolContract, 1),
        poolContract.totalSupply?.() || '0'
      ]);

      const price = this.calculatePrice(reserve0, reserve1);

      return {
        address: poolAddress,
        token0,
        token1,
        fee: this.config.fee,
        reserve0,
        reserve1,
        totalSupply: totalSupply.toString(),
        price
      };
    } catch (error: unknown) {
      throw new ContractError(
        `Failed to get pool info for ${this.name}`,
        this.factory ? String(this.factory.target) : undefined,
        error
      );
    }
  }

  /**
   * Get pool liquidity
   */
  async getLiquidity(token0: string, token1: string): Promise<string> {
    const poolInfo = await this.getPoolInfo(token0, token1);
    return poolInfo.totalSupply;
  }

  /**
   * Add liquidity to a pool
   */
  async addLiquidity(
    token0: string,
    token1: string,
    amount0: string,
    amount1: string
  ): Promise<any> {
    try {
      // Get signer address
      const signer = await this.provider.getEvmProvider().getSigner?.();
      const signerAddress = signer ? await signer.getAddress() : '';

      // Ensure token approvals
      await Promise.all([
        this.ensureTokenApproval(token0, amount0, signerAddress),
        this.ensureTokenApproval(token1, amount1, signerAddress)
      ]);

      // Build add liquidity transaction
      const calldata = await this.buildAddLiquidityCalldata(token0, token1, amount0, amount1, signerAddress);
      
      const tx = await this.provider.sendTransaction({
        to: this.router.target,
        data: calldata
      });

      return tx;
    } catch (error: unknown) {
      throw new TransactionError(
        `Failed to add liquidity on ${this.name}`,
        undefined,
        error
      );
    }
  }

  /**
   * Remove liquidity from a pool
   */
  async removeLiquidity(
    token0: string,
    token1: string,
    liquidity: string
  ): Promise<any> {
    try {
      const poolAddress = await this.getPoolAddress(token0, token1);
      
      // Get signer address
      const signer = await this.provider.getEvmProvider().getSigner?.();
      const signerAddress = signer ? await signer.getAddress() : '';
      
      // Approve LP tokens
      await this.ensureTokenApproval(poolAddress, liquidity, signerAddress);
      
      // Build remove liquidity transaction
      const calldata = await this.buildRemoveLiquidityCalldata(token0, token1, liquidity, signerAddress);
      
      const tx = await this.provider.sendTransaction({
        to: this.router.target,
        data: calldata
      });

      return tx;
    } catch (error: unknown) {
      throw new TransactionError(
        `Failed to remove liquidity on ${this.name}`,
        undefined,
        error
      );
    }
  }

  // Protected utility methods
  protected async getPoolAddress(token0: string, token1: string): Promise<string> {
    if (!this.factory) {
      throw new Error('Factory contract not initialized');
    }

    // Normalize token order
    const [tokenA, tokenB] = this.sortTokens(token0, token1);
    
    try {
      return await this.factory.getPair(tokenA, tokenB);
    } catch (error: unknown) {
      throw new ContractError('Failed to get pool address', String(this.factory.target), error);
    }
  }

  protected sortTokens(token0: string, token1: string): [string, string] {
    return token0.toLowerCase() < token1.toLowerCase() ? [token0, token1] : [token1, token0];
  }

  protected async findBestRoute(tokenIn: string, tokenOut: string): Promise<string[]> {
    // Simple direct route first
    const directRoute = [tokenIn, tokenOut];
    
    try {
      await this.getAmountsOut('1000000000000000000', directRoute); // Test with 1 token
      return directRoute;
    } catch {
      // Try route through WETH
      const wethRoute = [tokenIn, this.config.wethAddress, tokenOut];
      try {
        await this.getAmountsOut('1000000000000000000', wethRoute);
        return wethRoute;
      } catch {
        // Return direct route as fallback
        return directRoute;
      }
    }
  }

  protected async getAmountsOut(amountIn: string, path: string[]): Promise<string> {
    try {
      const amounts = await this.router.getAmountsOut(amountIn, path);
      return amounts[amounts.length - 1].toString();
    } catch (error: unknown) {
      throw new ContractError('Failed to get amounts out', String(this.router.target), error);
    }
  }

  protected async calculatePriceImpact(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    amountOut: string
  ): Promise<number> {
    try {
      const poolInfo = await this.getPoolInfo(tokenIn, tokenOut);
      const [reserve0, reserve1] = [BigInt(poolInfo.reserve0), BigInt(poolInfo.reserve1)];
      
      // Calculate spot price
      const spotPrice = Number(reserve1 * BigInt(1e18) / reserve0) / 1e18;
      
      // Calculate execution price
      const executionPrice = Number(BigInt(amountOut) * BigInt(1e18) / BigInt(amountIn)) / 1e18;
      
      // Price impact as percentage
      return Math.abs((executionPrice - spotPrice) / spotPrice) * 100;
    } catch {
      return 0; // Return 0 if calculation fails
    }
  }

  protected calculateExecutionPrice(
    amountIn: string,
    amountOut: string,
    decimalsIn: number,
    decimalsOut: number
  ): string {
    const adjustedAmountIn = BigInt(amountIn) * BigInt(10 ** (18 - decimalsIn));
    const adjustedAmountOut = BigInt(amountOut) * BigInt(10 ** (18 - decimalsOut));
    
    return (adjustedAmountOut * BigInt(1e18) / adjustedAmountIn).toString();
  }

  protected calculateFee(amountIn: string): string {
    const feeAmount = BigInt(amountIn) * BigInt(this.config.fee) / BigInt(10000);
    return feeAmount.toString();
  }

  protected validateSwapParams(params: SwapParams): void {
    if (!ethers.isAddress(params.tokenIn)) {
      throw new Error('Invalid tokenIn address');
    }
    if (!ethers.isAddress(params.tokenOut)) {
      throw new Error('Invalid tokenOut address');
    }
    if (BigInt(params.amountIn) <= 0) {
      throw new Error('Invalid amountIn');
    }
    if (BigInt(params.amountOutMin) < 0) {
      throw new Error('Invalid amountOutMin');
    }
    if (params.deadline < Math.floor(Date.now() / 1000)) {
      throw new Error('Deadline has passed');
    }
  }

  protected async ensureTokenApproval(
    tokenAddress: string,
    amount: string,
    spender: string
  ): Promise<void> {
    if (this.isNativeToken(tokenAddress)) {
      return; // No approval needed for native token
    }

    const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider.getEvmProvider());
    const currentAllowance = await tokenContract.allowance(spender, this.router.target);
    
    if (currentAllowance < BigInt(amount)) {
      const approveTx = await tokenContract.approve(this.router.target, ethers.MaxUint256);
      await this.provider.waitForTransaction(approveTx.hash);
    }
  }

  protected isNativeToken(address: string): boolean {
    return address.toLowerCase() === this.config.wethAddress.toLowerCase() ||
           address === ethers.ZeroAddress;
  }

  protected async getTokenDecimals(tokenAddress: string): Promise<number> {
    if (this.isNativeToken(tokenAddress)) {
      return 18;
    }

    try {
      const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider.getEvmProvider());
      return await tokenContract.decimals();
    } catch {
      return 18; // Default to 18 decimals
    }
  }

  protected calculatePrice(reserve0: string, reserve1: string): string {
    if (BigInt(reserve0) === BigInt(0)) return '0';
    return (BigInt(reserve1) * BigInt(1e18) / BigInt(reserve0)).toString();
  }

  // Abstract methods for specific pool implementations
  protected abstract getPoolABI(): any[];
  protected abstract getReserve(poolContract: Contract, index: number): Promise<string>;
  protected abstract buildAddLiquidityCalldata(
    token0: string,
    token1: string,
    amount0: string,
    amount1: string,
    signerAddress?: string
  ): Promise<string>;
  protected abstract buildRemoveLiquidityCalldata(
    token0: string,
    token1: string,
    liquidity: string,
    signerAddress?: string
  ): Promise<string>;
}