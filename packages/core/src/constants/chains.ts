export const CHAINS = {
  SEI_MAINNET: {
    id: 1329,
    name: 'Sei Network',
    network: 'sei',
    nativeCurrency: {
      name: 'Sei',
      symbol: 'SEI',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://evm-rpc.sei-apis.com'],
      },
      public: {
        http: ['https://evm-rpc.sei-apis.com'],
      },
    },
    blockExplorerUrls: ['https://seitrace.com'],
    contracts: {
      multicall3: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
  SEI_TESTNET: {
    id: 713715,
    name: 'Sei Testnet',
    network: 'sei-testnet',
    nativeCurrency: {
      name: 'Sei',
      symbol: 'SEI',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://evm-rpc-testnet.sei-apis.com'],
      },
      public: {
        http: ['https://evm-rpc-testnet.sei-apis.com'],
      },
    },
    blockExplorerUrls: ['https://seitrace.com/?chain=sei-testnet'],
    contracts: {
      multicall3: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
} as const;

export const DEFAULT_CHAIN = CHAINS.SEI_MAINNET;

export const SUPPORTED_CHAINS = [CHAINS.SEI_MAINNET, CHAINS.SEI_TESTNET];

export const BLOCK_TIME = 390; // 390ms average block time on Sei