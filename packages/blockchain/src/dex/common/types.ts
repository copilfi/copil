import { Address } from 'viem';

export interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOutMinimum?: bigint;
  recipient?: Address;
  deadline?: number;
}

export interface ExactInputSingleParams extends SwapParams {
  fee: number;
  sqrtPriceLimitX96?: bigint;
}

export interface ExactOutputSingleParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  amountOut: bigint;
  amountInMaximum: bigint;
  recipient: Address;
  sqrtPriceLimitX96?: bigint;
}

export interface SwapResult {
  hash: string;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
}

export interface DexConfig {
  routerAddress: Address;
  factoryAddress?: Address;
  quoterAddress?: Address;
  name: string;
  version?: string;
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  name: string;
}

export interface PoolInfo {
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number;
  poolAddress: Address;
}