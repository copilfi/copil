/**
 * Blockchain Constants
 * Centralized constants for clean configuration
 */

// Network Configuration
export const SUPPORTED_NETWORKS = {
  SEI_MAINNET: {
    chainId: 1329,
    name: 'Sei Pacific',
    rpcUrl: 'https://evm-rpc.sei-apis.com',
    wsUrl: 'wss://evm-ws.sei-apis.com',
    blockExplorer: 'https://seitrace.com',
    nativeCurrency: {
      name: 'Sei',
      symbol: 'SEI',
      decimals: 18,
    },
  },
  SEI_TESTNET: {
    chainId: 713715,
    name: 'Sei Atlantic',
    rpcUrl: 'https://evm-rpc-testnet.sei-apis.com',
    wsUrl: 'wss://evm-ws-testnet.sei-apis.com',
    blockExplorer: 'https://seitrace.com/?chain=atlantic-2',
    nativeCurrency: {
      name: 'Sei',
      symbol: 'SEI',
      decimals: 18,
    },
  }
} as const;

// Transaction Configuration
export const TRANSACTION_DEFAULTS = {
  GAS_LIMIT_BUFFER: 1.2, // 20% buffer
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  CONFIRMATION_BLOCKS: 1,
  TIMEOUT: 60000, // 1 minute
} as const;

// Gas Configuration
export const GAS_SETTINGS = {
  STANDARD: {
    gasPrice: '1000000000', // 1 gwei
    maxFeePerGas: '2000000000', // 2 gwei
    maxPriorityFeePerGas: '1000000000', // 1 gwei
  },
  FAST: {
    gasPrice: '2000000000', // 2 gwei
    maxFeePerGas: '4000000000', // 4 gwei
    maxPriorityFeePerGas: '2000000000', // 2 gwei
  },
  URGENT: {
    gasPrice: '5000000000', // 5 gwei
    maxFeePerGas: '10000000000', // 10 gwei
    maxPriorityFeePerGas: '5000000000', // 5 gwei
  },
} as const;

// Smart Account Configuration  
export const SMART_ACCOUNT_DEFAULTS = {
  ENTRY_POINT_ADDRESS: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  ACCOUNT_FACTORY_ADDRESS: '0xcF7038Cd52C5BE08EEdFa3f042B9842AFaBB99A2',
  CONDITIONAL_ORDER_ENGINE_ADDRESS: '0x425020571862cfDc97727bB6c920866D8BeAbbeB',
  SESSION_KEY_VALIDITY: 7 * 24 * 60 * 60, // 7 days in seconds
  MAX_SESSION_KEYS: 10,
  DEFAULT_SALT: '0x0000000000000000000000000000000000000000000000000000000000000000',
} as const;

// DEX Configuration
export const DEX_CONFIG = {
  ASTROPORT: {
    name: 'Astroport',
    routerAddress: '0x', // To be filled with actual addresses
    factoryAddress: '0x',
    quoterAddress: '0x',
    fee: 0.003, // 0.3%
  },
  DRAGONSWAP: {
    name: 'DragonSwap',
    routerAddress: '0x',
    factoryAddress: '0x',
    quoterAddress: '0x',
    fee: 0.0025, // 0.25%
  },
  WHITEWHALE: {
    name: 'White Whale',
    routerAddress: '0x',
    factoryAddress: '0x',
    quoterAddress: '0x',
    fee: 0.003, // 0.3%
  },
} as const;

// Common Token Addresses on Sei
export const TOKEN_ADDRESSES = {
  SEI: '0x0000000000000000000000000000000000000000', // Native token
  USDC: '0x', // To be filled
  USDT: '0x', // To be filled
  WETH: '0x', // To be filled
  WSEI: '0x', // To be filled
} as const;

// Validation Limits
export const VALIDATION_LIMITS = {
  MAX_GAS_LIMIT: 30_000_000,
  MIN_GAS_LIMIT: 21_000,
  MAX_STRING_LENGTH: 1_000,
  MAX_ARRAY_LENGTH: 100,
  MAX_SESSION_KEYS: 10,
  MAX_ALLOWED_TARGETS: 20,
} as const;

// Event Names
export const EVENT_NAMES = {
  ACCOUNT_CREATED: 'AccountCreated',
  SESSION_KEY_CREATED: 'SessionKeyCreated',
  SESSION_KEY_REVOKED: 'SessionKeyRevoked',
  ORDER_CREATED: 'OrderCreated',
  ORDER_EXECUTED: 'OrderExecuted',
  ORDER_CANCELLED: 'OrderCancelled',
  SWAP_EXECUTED: 'SwapExecuted',
} as const;

// Error Codes
export const ERROR_CODES = {
  BLOCKCHAIN_ERROR: 'BLOCKCHAIN_ERROR',
  CONTRACT_ERROR: 'CONTRACT_ERROR',
  TRANSACTION_ERROR: 'TRANSACTION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  PYTH: 'https://hermes.pyth.network',
  COINGECKO: 'https://api.coingecko.com/api/v3',
  DEFILLAMA: 'https://api.llama.fi',
} as const;

export type SupportedNetwork = keyof typeof SUPPORTED_NETWORKS;
export type GasSpeed = keyof typeof GAS_SETTINGS;
export type SupportedDex = keyof typeof DEX_CONFIG;
export type SupportedToken = keyof typeof TOKEN_ADDRESSES;