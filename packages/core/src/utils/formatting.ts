import { Decimal } from 'decimal.js';

export const formatAddress = (address: string, length = 6): string => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, length + 2)}...${address.slice(-length)}`;
};

export const formatTokenAmount = (
  amount: Decimal | string | number,
  decimals: number = 6
): string => {
  const decimal = new Decimal(amount);
  
  if (decimal.isZero()) return '0';
  
  // For very small amounts, show more decimal places
  if (decimal.lt(0.01)) {
    return decimal.toFixed(8);
  }
  
  // For amounts less than 1, show 4 decimal places
  if (decimal.lt(1)) {
    return decimal.toFixed(4);
  }
  
  // For amounts less than 1000, show 2-4 decimal places
  if (decimal.lt(1000)) {
    return decimal.toFixed(decimals);
  }
  
  // For larger amounts, use abbreviated format
  return formatLargeNumber(decimal, decimals);
};

export const formatLargeNumber = (
  amount: Decimal | string | number,
  decimals: number = 2
): string => {
  const decimal = new Decimal(amount);
  
  const units = [
    { value: 1e12, symbol: 'T' },
    { value: 1e9, symbol: 'B' },
    { value: 1e6, symbol: 'M' },
    { value: 1e3, symbol: 'K' },
  ];
  
  for (const unit of units) {
    if (decimal.gte(unit.value)) {
      return `${decimal.div(unit.value).toFixed(decimals)}${unit.symbol}`;
    }
  }
  
  return decimal.toFixed(decimals);
};

export const formatPercentage = (
  value: number,
  decimals: number = 2,
  includeSign: boolean = true
): string => {
  const sign = includeSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
};

export const formatCurrency = (
  amount: Decimal | string | number,
  currency: string = 'USD',
  decimals: number = 2
): string => {
  const decimal = new Decimal(amount);
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  return formatter.format(decimal.toNumber());
};

export const formatTime = (date: Date | string | number): string => {
  const d = new Date(date);
  return d.toLocaleString();
};

export const formatTimeAgo = (date: Date | string | number): string => {
  const now = new Date();
  const target = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - target.getTime()) / 1000);
  
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
    { label: 'second', seconds: 1 },
  ];
  
  for (const interval of intervals) {
    const count = Math.floor(diffInSeconds / interval.seconds);
    if (count > 0) {
      return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
    }
  }
  
  return 'just now';
};

export const formatGasPrice = (gasPrice: bigint | string | number): string => {
  const gwei = new Decimal(gasPrice.toString()).div(1e9);
  return `${gwei.toFixed(2)} Gwei`;
};

export const formatTransactionHash = (hash: string, length: number = 8): string => {
  return formatAddress(hash, length);
};

export const formatSlippage = (slippage: number): string => {
  return `${slippage}%`;
};

export const formatAPY = (apy: number): string => {
  return formatPercentage(apy, 2, false);
};