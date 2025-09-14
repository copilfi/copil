import { z } from 'zod';
import type { 
  TransactionRequest, 
  TransactionResponse, 
  Block, 
  Log 
} from 'ethers';

// Export error types
export { 
  BlockchainError, 
  ContractError, 
  TransactionError, 
  NetworkError, 
  ValidationError 
} from './errors';

// Network configuration
export const NetworkConfigSchema = z.object({
  chainId: z.number(),
  name: z.string(),
  rpcUrl: z.string(),
  wsUrl: z.string().optional(),
  blockExplorer: z.string(),
  nativeCurrency: z.object({
    name: z.string(),
    symbol: z.string(),
    decimals: z.number(),
  }),
  contracts: z.object({
    entryPoint: z.string(),
    accountFactory: z.string().optional(),
    conditionalOrderEngine: z.string().optional(),
  }),
});

export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;

// Transaction types
export interface SeiTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  nonce: number;
  data: string;
  blockNumber?: number;
  blockHash?: string;
  timestamp?: number;
  status?: 'pending' | 'confirmed' | 'failed';
}

// Smart Account types
export interface SmartAccountConfig {
  owner: string;
  entryPoint: string;
  factory: string;
  salt: string;
}

export interface SessionKeyConfig {
  sessionKey: string;
  validUntil: number;
  limitAmount: string;
  allowedTargets: string[];
  allowedFunctions: string[];
}

// ERC-4337 UserOperation
export interface UserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
}

// DEX trading types
export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  recipient: string;
  deadline: number;
  slippageTolerance: number;
}

export interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  price: string;
}

export interface PriceQuote {
  amountOut: string;
  priceImpact: number;
  executionPrice: string;
  fee: string;
  route: string[];
}

// Provider interfaces
export interface IBlockchainProvider {
  getBalance(address: string): Promise<string>;
  getTransaction(hash: string): Promise<SeiTransaction | null>;
  sendTransaction(tx: TransactionRequest): Promise<TransactionResponse>;
  waitForTransaction(hash: string): Promise<TransactionResponse>;
  estimateGas(tx: TransactionRequest): Promise<string>;
  getGasPrice(): Promise<string>;
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<Block | null>;
  getLogs(filter: any): Promise<Log[]>;
  call(tx: TransactionRequest): Promise<string>;
}

export interface IDexAdapter {
  name: string;
  getQuote(params: SwapParams): Promise<PriceQuote>;
  executeSwap(params: SwapParams): Promise<TransactionResponse>;
  getPoolInfo(token0: string, token1: string): Promise<PoolInfo>;
  getLiquidity(token0: string, token1: string): Promise<string>;
  addLiquidity(token0: string, token1: string, amount0: string, amount1: string): Promise<TransactionResponse>;
  removeLiquidity(token0: string, token1: string, liquidity: string): Promise<TransactionResponse>;
}

// Contract interaction types
export interface ContractCallParams {
  address: string;
  abi: any[];
  method: string;
  params: any[];
  value?: string;
}

export interface ContractEventFilter {
  address: string;
  topics?: string[];
  fromBlock?: number;
  toBlock?: number;
}

// Gas estimation
export interface GasEstimate {
  gasLimit: string;
  gasPrice: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedCost: string;
}

// WebSocket event types
export interface BlockEvent {
  type: 'block';
  data: {
    number: number;
    hash: string;
    timestamp: number;
    transactions: string[];
  };
}

export interface TransactionEvent {
  type: 'transaction';
  data: SeiTransaction;
}

export interface LogEvent {
  type: 'log';
  data: Log;
}

export type BlockchainEvent = BlockEvent | TransactionEvent | LogEvent;

// Error types are exported from ./errors above

// Sei-specific types
export interface SeiCosmosTransaction {
  height: string;
  txhash: string;
  raw_log: string;
  logs: any[];
  gas_wanted: string;
  gas_used: string;
  timestamp: string;
  tx: {
    '@type': string;
    body: {
      messages: any[];
      memo: string;
      timeout_height: string;
      extension_options: any[];
      non_critical_extension_options: any[];
    };
    auth_info: {
      signer_infos: any[];
      fee: {
        amount: any[];
        gas_limit: string;
        payer: string;
        granter: string;
      };
    };
    signatures: string[];
  };
}

export interface SeiAccountInfo {
  '@type': string;
  address: string;
  pub_key?: {
    '@type': string;
    key: string;
  };
  account_number: string;
  sequence: string;
}

// CosmWasm contract types
export interface CosmWasmContract {
  address: string;
  codeId: number;
  creator: string;
  admin?: string;
  label: string;
}