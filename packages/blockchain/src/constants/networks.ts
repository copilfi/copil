import type { NetworkConfig } from '../types';

export const SEI_TESTNET: NetworkConfig = {
  chainId: 713715,
  name: 'Sei Testnet',
  rpcUrl: 'https://evm-rpc-testnet.sei-apis.com',
  wsUrl: 'wss://evm-ws-testnet.sei-apis.com',
  blockExplorer: 'https://seitrace.com/?chain=sei-testnet',
  nativeCurrency: {
    name: 'SEI',
    symbol: 'SEI',
    decimals: 18,
  },
  contracts: {
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789', // Standard EntryPoint v0.6
    // These will be populated after deployment
    accountFactory: '',
    conditionalOrderEngine: '',
  },
};

export const SEI_MAINNET: NetworkConfig = {
  chainId: 1329,
  name: 'Sei Mainnet',
  rpcUrl: 'https://evm-rpc.sei-apis.com',
  wsUrl: 'wss://evm-ws.sei-apis.com',
  blockExplorer: 'https://seitrace.com',
  nativeCurrency: {
    name: 'SEI',
    symbol: 'SEI',
    decimals: 18,
  },
  contracts: {
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    accountFactory: '',
    conditionalOrderEngine: '',
  },
};

export const NETWORKS: Record<string, NetworkConfig> = {
  'sei-testnet': SEI_TESTNET,
  'sei-mainnet': SEI_MAINNET,
};

export const DEFAULT_NETWORK = SEI_TESTNET;

// Sei Cosmos RPC endpoints
export const SEI_COSMOS_TESTNET_RPC = 'https://rpc-testnet.sei-apis.com';
export const SEI_COSMOS_MAINNET_RPC = 'https://rpc.sei-apis.com';

// Sei LCD (REST) endpoints
export const SEI_COSMOS_TESTNET_LCD = 'https://lcd-testnet.sei-apis.com';
export const SEI_COSMOS_MAINNET_LCD = 'https://lcd.sei-apis.com';

// Block time constants (Sei's ~390ms block time)
export const SEI_BLOCK_TIME = 390; // milliseconds
export const SEI_BLOCKS_PER_MINUTE = Math.floor(60000 / SEI_BLOCK_TIME); // ~154 blocks
export const SEI_BLOCKS_PER_HOUR = SEI_BLOCKS_PER_MINUTE * 60; // ~9230 blocks