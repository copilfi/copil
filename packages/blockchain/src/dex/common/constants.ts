import { Address } from 'viem';
import { DexConfig } from './types';

export const DRAGONSWAP_CONFIG: DexConfig = {
  routerAddress: '0x11DA6463D6Cb5a03411Dbf5ab6f6bc3997Ac7428' as Address,
  quoterAddress: '0x8700e3cd02C8CA18b8d38F9030Cd5e23f0D4B50A' as Address,
  name: 'DragonSwap',
  version: 'v3'
};

export const SYMPHONY_CONFIG: DexConfig = {
  routerAddress: '0x7F23d86Ee9b4A2Cc2C91DdD3d5D42A5a1e03a7e4' as Address,
  name: 'Symphony',
  version: 'v1'
};

export const WSEI_ADDRESS: Address = '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7';
export const NATIVE_SEI_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export const DEFAULT_DEADLINE_MINUTES = 20;
export const DEFAULT_SLIPPAGE_TOLERANCE = 0.005; // 0.5%

export const COMMON_TOKENS = {
  WSEI: {
    address: WSEI_ADDRESS,
    symbol: 'WSEI',
    decimals: 18,
    name: 'Wrapped SEI'
  },
  SEI: {
    address: NATIVE_SEI_ADDRESS,
    symbol: 'SEI',
    decimals: 18,
    name: 'SEI'
  }
} as const;