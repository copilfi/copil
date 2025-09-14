import { Decimal } from 'decimal.js';

export const calculatePriceImpact = (
  inputAmount: Decimal,
  outputAmount: Decimal,
  marketRate: Decimal
): number => {
  const expectedOutput = inputAmount.mul(marketRate);
  const impact = expectedOutput.sub(outputAmount).div(expectedOutput).mul(100);
  return Math.max(0, impact.toNumber());
};

export const calculateSlippage = (
  expectedAmount: Decimal,
  actualAmount: Decimal
): number => {
  const slippage = expectedAmount.sub(actualAmount).div(expectedAmount).mul(100);
  return Math.max(0, slippage.toNumber());
};

export const calculateMinAmountOut = (
  expectedAmount: Decimal,
  slippageTolerance: number
): Decimal => {
  const slippageDecimal = new Decimal(slippageTolerance).div(100);
  return expectedAmount.mul(new Decimal(1).sub(slippageDecimal));
};

export const calculateGasFee = (
  gasUsed: bigint,
  gasPrice: bigint
): bigint => {
  return gasUsed * gasPrice;
};

export const calculatePortfolioValue = (
  assets: Array<{ amount: Decimal; priceUSD: Decimal }>
): Decimal => {
  return assets.reduce((total, asset) => {
    return total.add(asset.amount.mul(asset.priceUSD));
  }, new Decimal(0));
};

export const calculateAllocation = (
  assetValue: Decimal,
  totalValue: Decimal
): number => {
  if (totalValue.isZero()) return 0;
  return assetValue.div(totalValue).mul(100).toNumber();
};

export const calculatePnL = (
  currentValue: Decimal,
  costBasis: Decimal
): { absolute: Decimal; percentage: number } => {
  const absolute = currentValue.sub(costBasis);
  const percentage = costBasis.isZero() ? 0 : absolute.div(costBasis).mul(100).toNumber();
  
  return { absolute, percentage };
};

export const calculateSharpeRatio = (
  returns: number[],
  riskFreeRate: number = 0
): number => {
  if (returns.length === 0) return 0;
  
  const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
  const excessReturn = meanReturn - riskFreeRate;
  
  const variance = returns.reduce((sum, ret) => {
    return sum + Math.pow(ret - meanReturn, 2);
  }, 0) / returns.length;
  
  const standardDeviation = Math.sqrt(variance);
  
  return standardDeviation === 0 ? 0 : excessReturn / standardDeviation;
};

export const calculateMaxDrawdown = (returns: number[]): number => {
  if (returns.length === 0) return 0;
  
  let peak = 1;
  let maxDrawdown = 0;
  let current = 1;
  
  for (const ret of returns) {
    current *= (1 + ret / 100);
    
    if (current > peak) {
      peak = current;
    } else {
      const drawdown = (peak - current) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
  }
  
  return maxDrawdown * 100;
};

export const calculateVolatility = (returns: number[]): number => {
  if (returns.length === 0) return 0;
  
  const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
  
  const variance = returns.reduce((sum, ret) => {
    return sum + Math.pow(ret - meanReturn, 2);
  }, 0) / returns.length;
  
  return Math.sqrt(variance);
};

export const calculateBeta = (
  assetReturns: number[],
  marketReturns: number[]
): number => {
  if (assetReturns.length !== marketReturns.length || assetReturns.length === 0) {
    return 1; // Default beta
  }
  
  const assetMean = assetReturns.reduce((sum, ret) => sum + ret, 0) / assetReturns.length;
  const marketMean = marketReturns.reduce((sum, ret) => sum + ret, 0) / marketReturns.length;
  
  let covariance = 0;
  let marketVariance = 0;
  
  for (let i = 0; i < assetReturns.length; i++) {
    const assetDeviation = assetReturns[i] - assetMean;
    const marketDeviation = marketReturns[i] - marketMean;
    
    covariance += assetDeviation * marketDeviation;
    marketVariance += marketDeviation * marketDeviation;
  }
  
  covariance /= assetReturns.length;
  marketVariance /= marketReturns.length;
  
  return marketVariance === 0 ? 1 : covariance / marketVariance;
};

export const calculateCompoundReturn = (
  initialAmount: Decimal,
  interestRate: number,
  periods: number,
  compoundingFrequency: number = 1
): Decimal => {
  const ratePerPeriod = interestRate / (100 * compoundingFrequency);
  const totalPeriods = periods * compoundingFrequency;
  
  return initialAmount.mul(new Decimal(1 + ratePerPeriod).pow(totalPeriods));
};

export const calculateLiquidityDepth = (
  orderbook: Array<{ price: number; quantity: number }>,
  targetAmount: Decimal
): { depth: Decimal; averagePrice: Decimal } => {
  let remainingAmount = targetAmount;
  let totalCost = new Decimal(0);
  let totalQuantity = new Decimal(0);
  
  for (const order of orderbook) {
    if (remainingAmount.isZero()) break;
    
    const orderQuantity = new Decimal(order.quantity);
    const takeQuantity = Decimal.min(remainingAmount, orderQuantity);
    
    totalCost = totalCost.add(takeQuantity.mul(order.price));
    totalQuantity = totalQuantity.add(takeQuantity);
    remainingAmount = remainingAmount.sub(takeQuantity);
  }
  
  const averagePrice = totalQuantity.isZero() ? new Decimal(0) : totalCost.div(totalQuantity);
  
  return {
    depth: totalQuantity,
    averagePrice,
  };
};