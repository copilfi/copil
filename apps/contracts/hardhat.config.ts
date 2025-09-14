import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import '@typechain/hardhat';
import 'hardhat-deploy';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-watcher';

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.20',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000, // Optimized for production deployment
          },
          viaIR: true,
        },
      },
      {
        version: '0.8.23',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000, // Optimized for production deployment
          },
          viaIR: true,
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: 1337,
      accounts: {
        count: 20,
        accountsBalance: '10000000000000000000000', // 10,000 ETH
      },
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 1337,
    },
    'sei-testnet': {
      url: process.env.SEI_TESTNET_RPC_URL || 'https://evm-rpc-testnet.sei-apis.com',
      chainId: 713715,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      gas: 'auto',
    },
    'sei-mainnet': {
      url: process.env.SEI_RPC_URL || 'https://evm-rpc.sei-apis.com',
      chainId: 1329,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      gas: 'auto',
    },
    seiMainnet: {
      url: process.env.SEI_RPC_URL || 'https://evm-rpc.sei-apis.com',
      chainId: 1329,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      gas: 'auto',
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    admin: {
      default: 1,
    },
    user: {
      default: 2,
    },
  },
  verify: {
    etherscan: {
      apiKey: {
        'sei-testnet': process.env.SEI_ETHERSCAN_API_KEY || '',
        'sei-mainnet': process.env.SEI_ETHERSCAN_API_KEY || '',
      },
      customChains: [
        {
          network: 'sei-testnet',
          chainId: 713715,
          urls: {
            apiURL: 'https://seitrace.com/api',
            browserURL: 'https://seitrace.com/?chain=sei-testnet',
          },
        },
        {
          network: 'sei-mainnet',
          chainId: 1329,
          urls: {
            apiURL: 'https://seitrace.com/api',
            browserURL: 'https://seitrace.com',
          },
        },
      ],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
    gasPrice: 20,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
    deploy: './deploy',
  },
  watcher: {
    compilation: {
      tasks: ['compile'],
      files: ['./contracts'],
      verbose: true,
    },
    test: {
      tasks: [{ command: 'test', params: { testFiles: ['{path}'] } }],
      files: ['./test/**/*'],
      verbose: true,
    },
  },
  mocha: {
    timeout: 40000,
    color: true,
    bail: false,
  },
};

export default config;