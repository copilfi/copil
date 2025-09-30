import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';
import { logger } from '@/utils/logger';

export interface StrategyCondition {
  type: 'price' | 'time' | 'volume' | 'technical_indicator';
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  value: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  indicator?: string;
  metadata?: Record<string, any>;
  normalized?: boolean;
  sourceType?: string;
}

export interface StrategyConditionNormalizationOutcome {
  normalized: StrategyCondition[];
  changed: boolean;
  skipped: number;
}

export interface ConditionCache {
  bySymbol: Map<string, TokenInfo>;
  byAddress: Map<string, TokenInfo>;
}

export interface TokenInfo {
  address: string;
  symbol?: string;
  name?: string;
}

export interface ConditionNormalizationContext {
  prisma: PrismaClient;
  blockchainService?: { registerTokenMetadata(address: string, symbol?: string): void };
  cache?: ConditionCache;
}

export function createConditionCache(): ConditionCache {
  return {
    bySymbol: new Map<string, TokenInfo>(),
    byAddress: new Map<string, TokenInfo>()
  };
}

export async function normalizeStrategyConditions(
  strategyId: string,
  rawConditions: any[],
  context: ConditionNormalizationContext
): Promise<StrategyConditionNormalizationOutcome> {
  const cache = context.cache ?? createConditionCache();
  const normalized: StrategyCondition[] = [];
  let changed = false;
  let skipped = 0;

  for (const raw of rawConditions) {
    const { condition, mutated } = await normalizeCondition(strategyId, raw, context, cache);
    if (!condition) {
      skipped += 1;
      changed = true;
      continue;
    }

    if (mutated) {
      changed = true;
    }

    normalized.push(condition);
  }

  return {
    normalized,
    changed,
    skipped
  };
}

async function normalizeCondition(
  strategyId: string,
  rawCondition: any,
  context: ConditionNormalizationContext,
  cache: ConditionCache
): Promise<{ condition: StrategyCondition | null; mutated: boolean }> {
  if (!rawCondition || typeof rawCondition !== 'object') {
    logger.warn(`Strategy ${strategyId}: skipping malformed condition ${JSON.stringify(rawCondition)}`);
    return { condition: null, mutated: true };
  }

  if (rawCondition.normalized === true) {
    return normalizeAlreadyCanonical(rawCondition, context, cache);
  }

  const rawType = typeof rawCondition.type === 'string' ? rawCondition.type.toLowerCase() : '';

  switch (rawType) {
    case 'price_below':
    case 'price_above': {
      const operator: StrategyCondition['operator'] = rawType === 'price_below' ? 'lt' : 'gt';
      const tokenInfo = await resolveTokenInfo(context, cache, rawCondition.tokenAddress, rawCondition.token || rawCondition.tokenSymbol);

      if (!tokenInfo) {
        logger.error(`Strategy ${strategyId}: unable to resolve token for price condition ${JSON.stringify(rawCondition)}`);
        return { condition: null, mutated: true };
      }

      cacheTokenInfo(context, cache, tokenInfo);

      const condition: StrategyCondition = {
        type: 'price',
        operator,
        value: String(rawCondition.value ?? '0'),
        tokenAddress: tokenInfo.address,
        tokenSymbol: tokenInfo.symbol,
        metadata: {
          ...(rawCondition.metadata || {}),
          sourceType: rawType
        },
        normalized: true
      };

      return { condition, mutated: true };
    }
    case 'time_after':
    case 'time_before': {
      const schedule = parseTimeCondition(rawCondition.value, rawType === 'time_before');
      if (!schedule) {
        logger.error(`Strategy ${strategyId}: unable to parse time condition ${JSON.stringify(rawCondition)}`);
        return { condition: null, mutated: true };
      }

      const condition: StrategyCondition = {
        type: 'time',
        operator: schedule.operator,
        value: schedule.timeValue,
        metadata: {
          ...(rawCondition.metadata || {}),
          ...schedule.metadata,
          sourceType: rawType
        },
        normalized: true
      };

      return { condition, mutated: true };
    }
    case 'price':
    case 'time':
    case 'volume':
    case 'technical_indicator': {
      const normalizedOperator = normalizeOperator(rawCondition.operator);
      const tokenSymbol = rawCondition.tokenSymbol || rawCondition.token;

      let tokenAddress: string | undefined = rawCondition.tokenAddress;
      if (!tokenAddress && tokenSymbol) {
        const tokenInfo = await resolveTokenInfo(context, cache, undefined, tokenSymbol);
        if (tokenInfo) {
          cacheTokenInfo(context, cache, tokenInfo);
          tokenAddress = tokenInfo.address;
        }
      }

      const conditionType = asStrategyConditionType(rawType);
      if (!conditionType) {
        logger.warn(`Strategy ${strategyId}: unsupported condition type ${rawCondition.type}`);
        return { condition: null, mutated: true };
      }

      const normalizedCondition: StrategyCondition = {
        type: conditionType,
        operator: normalizedOperator,
        value: String(rawCondition.value ?? ''),
        tokenAddress,
        tokenSymbol: tokenSymbol ? String(tokenSymbol).toUpperCase() : undefined,
        indicator: rawCondition.indicator,
        metadata: {
          ...(rawCondition.metadata || {}),
          sourceType: rawCondition.sourceType || rawType
        },
        normalized: true
      };

      if (tokenAddress) {
        cacheTokenInfo(context, cache, {
          address: tokenAddress,
          symbol: normalizedCondition.tokenSymbol
        });
      }

      const mutated = rawCondition.normalized !== true
        || normalizedCondition.operator !== rawCondition.operator
        || normalizedCondition.tokenSymbol !== rawCondition.tokenSymbol
        || normalizedCondition.value !== rawCondition.value;

      return { condition: normalizedCondition, mutated };
    }
    default:
      logger.warn(`Strategy ${strategyId}: skipping unsupported condition type ${rawCondition.type}`);
      return { condition: null, mutated: true };
  }
}

function normalizeOperator(operator: unknown): StrategyCondition['operator'] {
  switch (String(operator || '').toLowerCase()) {
    case 'gt':
    case '>':
      return 'gt';
    case 'lt':
    case '<':
      return 'lt';
    case 'gte':
    case '>=':
    case 'after':
      return 'gte';
    case 'lte':
    case '<=':
    case 'before':
      return 'lte';
    case 'eq':
    case '==':
      return 'eq';
    default:
      return 'eq';
  }
}

function parseTimeCondition(
  value: any,
  isBefore: boolean
): { timeValue: string; operator: StrategyCondition['operator']; metadata: Record<string, any> } | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const raw = value.trim();
  const lower = raw.toLowerCase();
  const dailyMatch = /^([0-2]\d:[0-5]\d)$/.exec(lower);
  const weeklyMatch = /^([a-z]+)_([0-2]\d:[0-5]\d)$/.exec(lower);

  if (weeklyMatch) {
    const dayIndex = dayNameToIndex(weeklyMatch[1]);
    if (dayIndex === null) {
      return null;
    }

    const timeOfDay = weeklyMatch[2];
    return {
      timeValue: timeOfDay,
      operator: isBefore ? 'lte' : 'gte',
      metadata: {
        schedule: 'weekly',
        dayOfWeek: dayIndex,
        timeOfDay
      }
    };
  }

  if (dailyMatch) {
    const timeOfDay = dailyMatch[1];
    return {
      timeValue: timeOfDay,
      operator: isBefore ? 'lte' : 'gte',
      metadata: {
        schedule: 'daily',
        timeOfDay
      }
    };
  }

  const timestamp = Date.parse(raw);
  if (!Number.isNaN(timestamp)) {
    return {
      timeValue: new Date(timestamp).toISOString(),
      operator: isBefore ? 'lte' : 'gte',
      metadata: {
        schedule: 'absolute'
      }
    };
  }

  return null;
}

function dayNameToIndex(dayName: string): number | null {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const index = days.indexOf(dayName.toLowerCase());
  return index === -1 ? null : index;
}

async function resolveTokenInfo(
  context: ConditionNormalizationContext,
  cache: ConditionCache,
  address?: string,
  symbol?: string
): Promise<TokenInfo | null> {
  if (address && typeof address === 'string' && isValidAddress(address)) {
    const normalized = address.toLowerCase();
    const cached = cache.byAddress.get(normalized);
    if (cached) {
      return cached;
    }

    const token = await context.prisma.tokenRegistry.findUnique({ where: { address } });
    const info: TokenInfo = token
      ? { address: token.address, symbol: token.symbol || undefined, name: token.name || undefined }
      : { address };

    cacheTokenInfo(context, cache, info);
    return info;
  }

  if (symbol && typeof symbol === 'string') {
    const normalizedSymbol = symbol.toUpperCase();
    const aliasAddress = resolveSymbolAlias(normalizedSymbol);
    if (aliasAddress) {
      const aliasInfo: TokenInfo = { address: aliasAddress, symbol: normalizedSymbol };
      cacheTokenInfo(context, cache, aliasInfo);
      return aliasInfo;
    }

    const cached = cache.bySymbol.get(normalizedSymbol);
    if (cached) {
      return cached;
    }

    const token = await context.prisma.tokenRegistry.findFirst({
      where: {
        symbol: {
          equals: symbol,
          mode: 'insensitive'
        },
        isActive: true
      }
    });

    if (!token) {
      return null;
    }

    const info: TokenInfo = { address: token.address, symbol: token.symbol || normalizedSymbol, name: token.name || undefined };
    cacheTokenInfo(context, cache, info);
    return info;
  }

  return null;
}

function cacheTokenInfo(
  context: ConditionNormalizationContext,
  cache: ConditionCache,
  info: TokenInfo
): void {
  if (!info.address) {
    return;
  }

  const normalizedAddress = info.address.toLowerCase();
  cache.byAddress.set(normalizedAddress, info);

  if (info.symbol) {
    const symbolKey = info.symbol.toUpperCase();
    cache.bySymbol.set(symbolKey, info);
    context.blockchainService?.registerTokenMetadata(info.address, symbolKey);
  }
}

function resolveSymbolAlias(symbol: string): string | null {
  switch (symbol) {
    case 'SEI':
      return ethers.ZeroAddress;
    default:
      return null;
  }
}

function isValidAddress(value: string): boolean {
  try {
    return ethers.isAddress(value);
  } catch (error) {
    return false;
  }
}

function asStrategyConditionType(value: unknown): StrategyCondition['type'] | null {
  switch (String(value).toLowerCase()) {
    case 'price':
      return 'price';
    case 'time':
      return 'time';
    case 'volume':
      return 'volume';
    case 'technical_indicator':
      return 'technical_indicator';
    default:
      return null;
  }
}

function normalizeAlreadyCanonical(
  rawCondition: any,
  context: ConditionNormalizationContext,
  cache: ConditionCache
): { condition: StrategyCondition | null; mutated: boolean } {
  const type = asStrategyConditionType(rawCondition.type);
  if (!type) {
    return { condition: null, mutated: true };
  }

  const operator = normalizeOperator(rawCondition.operator);
  const tokenSymbol = rawCondition.tokenSymbol ? String(rawCondition.tokenSymbol).toUpperCase() : undefined;
  const value = String(rawCondition.value ?? '');

  const condition: StrategyCondition = {
    type,
    operator,
    value,
    tokenAddress: rawCondition.tokenAddress,
    tokenSymbol,
    indicator: rawCondition.indicator,
    metadata: rawCondition.metadata || {},
    normalized: true,
    sourceType: rawCondition.sourceType
  };

  if (condition.tokenAddress) {
    cacheTokenInfo(context, cache, {
      address: condition.tokenAddress,
      symbol: tokenSymbol
    });
  }

  return { condition, mutated: false };
}
