import { Token, Address } from '../types';

export const NATIVE_TOKEN: Token = {
  address: '0x0000000000000000000000000000000000000000' as Address,
  symbol: 'SEI',
  name: 'Sei Network',
  decimals: 18,
  logoURI: 'https://assets.coingecko.com/coins/images/28205/thumb/Sei_Logo_-_Transparent.png',
  coingeckoId: 'sei-network',
};

// Sei Network tokens - these addresses will be updated with actual deployed addresses
export const TOKENS: { [key: string]: Token } = {
  SEI: NATIVE_TOKEN,
  USDC: {
    address: '0xA0b86a33E6411a3e5b84A1e8Ad1B7a92aa7a5Fd1' as Address, // Placeholder
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: 'https://assets.coingecko.com/coins/images/6319/thumb/USD_Coin_icon.png',
    coingeckoId: 'usd-coin',
  },
  USDT: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address, // Placeholder
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: 'https://assets.coingecko.com/coins/images/325/thumb/Tether.png',
    coingeckoId: 'tether',
  },
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // Placeholder
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    logoURI: 'https://assets.coingecko.com/coins/images/2518/thumb/weth.png',
    coingeckoId: 'ethereum',
  },
  WBTC: {
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address, // Placeholder
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    decimals: 8,
    logoURI: 'https://assets.coingecko.com/coins/images/7598/thumb/wrapped_bitcoin_wbtc.png',
    coingeckoId: 'wrapped-bitcoin',
  },
  ASTRO: {
    address: '0x8D983cb9388EaC77af0474fA441C4815500Cb7BB' as Address, // Placeholder
    symbol: 'ASTRO',
    name: 'Astroport',
    decimals: 18,
    logoURI: 'https://assets.coingecko.com/coins/images/18450/thumb/astroport.png',
    coingeckoId: 'astroport-fi',
  },
  DRAGON: {
    address: '0x123456789012345678901234567890123456789' as Address, // Placeholder
    symbol: 'DRAGON',
    name: 'DragonSwap Token',
    decimals: 18,
    logoURI: 'https://dragonswap.app/logo.png', // Placeholder
    coingeckoId: 'dragonswap',
  },
};

export const STABLE_TOKENS = ['USDC', 'USDT', 'DAI', 'FRAX'];

export const MAJOR_TOKENS = ['SEI', 'WETH', 'WBTC', 'USDC', 'USDT'];

export const DEX_TOKENS = ['ASTRO', 'DRAGON'];

export const TOKEN_LISTS = {
  STABLE: STABLE_TOKENS.map(symbol => TOKENS[symbol]).filter(Boolean),
  MAJOR: MAJOR_TOKENS.map(symbol => TOKENS[symbol]).filter(Boolean),
  DEX: DEX_TOKENS.map(symbol => TOKENS[symbol]).filter(Boolean),
  ALL: Object.values(TOKENS),
};

export const DEFAULT_TOKENS = [
  TOKENS.SEI,
  TOKENS.USDC,
  TOKENS.USDT,
  TOKENS.WETH,
  TOKENS.WBTC,
];