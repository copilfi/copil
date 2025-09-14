import { Address } from '../types';

export interface DEXConfig {
  name: string;
  displayName: string;
  routerAddress: Address;
  factoryAddress: Address;
  quoterAddress?: Address;
  logoURI: string;
  website: string;
  fees: number[]; // Fee tiers in basis points (e.g., 30 = 0.3%)
  version: string;
  isActive: boolean;
}

// DEX configurations for Sei Network
export const DEXES: { [key: string]: DEXConfig } = {
  ASTROPORT: {
    name: 'astroport',
    displayName: 'Astroport',
    routerAddress: '0x123456789012345678901234567890123456789A' as Address, // Placeholder
    factoryAddress: '0x123456789012345678901234567890123456789B' as Address, // Placeholder
    quoterAddress: '0x123456789012345678901234567890123456789C' as Address, // Placeholder
    logoURI: 'https://astroport.fi/astroport_logo.svg',
    website: 'https://astroport.fi',
    fees: [30, 100, 300, 1000], // 0.03%, 0.1%, 0.3%, 1%
    version: 'v1',
    isActive: true,
  },
  DRAGONSWAP: {
    name: 'dragonswap',
    displayName: 'DragonSwap',
    routerAddress: '0x123456789012345678901234567890123456789D' as Address, // Placeholder
    factoryAddress: '0x123456789012345678901234567890123456789E' as Address, // Placeholder
    quoterAddress: '0x123456789012345678901234567890123456789F' as Address, // Placeholder
    logoURI: 'https://dragonswap.app/logo.png',
    website: 'https://dragonswap.app',
    fees: [1, 5, 30, 100], // 0.01%, 0.05%, 0.3%, 1%
    version: 'v3',
    isActive: true,
  },
  WHITEWHALE: {
    name: 'whitewhale',
    displayName: 'White Whale',
    routerAddress: '0x123456789012345678901234567890123456789G' as Address, // Placeholder
    factoryAddress: '0x123456789012345678901234567890123456789H' as Address, // Placeholder
    logoURI: 'https://whitewhale.money/logo.svg',
    website: 'https://whitewhale.money',
    fees: [30, 100, 300], // 0.3%, 1%, 3%
    version: 'v1',
    isActive: true,
  },
  FUZIO: {
    name: 'fuzio',
    displayName: 'Fuzio Network',
    routerAddress: '0x123456789012345678901234567890123456789I' as Address, // Placeholder
    factoryAddress: '0x123456789012345678901234567890123456789J' as Address, // Placeholder
    logoURI: 'https://fuzio.network/logo.png',
    website: 'https://fuzio.network',
    fees: [25, 100, 300, 1000], // 0.25%, 1%, 3%, 10%
    version: 'v1',
    isActive: true,
  },
};

export const ACTIVE_DEXES = Object.values(DEXES).filter(dex => dex.isActive);

export const DEX_NAMES = Object.keys(DEXES);

export const DEFAULT_DEX = DEXES.ASTROPORT;

// DEX routing priority (for finding best routes)
export const DEX_PRIORITY = [
  'astroport',
  'dragonswap',
  'whitewhale',
  'fuzio',
];

// Fee settings
export const DEFAULT_SLIPPAGE = 0.5; // 0.5%
export const MAX_SLIPPAGE = 30; // 30%
export const MIN_SLIPPAGE = 0.01; // 0.01%

// Route settings
export const MAX_HOPS = 3;
export const MIN_LIQUIDITY_USD = 1000; // Minimum pool liquidity in USD
export const PRICE_IMPACT_THRESHOLD = 5; // 5% price impact threshold