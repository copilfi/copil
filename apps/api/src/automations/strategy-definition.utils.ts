import { BadRequestException } from '@nestjs/common';
import {
  StrategyDefinition,
  StrategyTriggerDefinition,
  TransactionAction,
} from '@copil/database';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }
  return value;
}

function ensureNumber(value: unknown, field: string): number {
  const numericValue =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  if (!Number.isFinite(numericValue)) {
    throw new BadRequestException(`${field} must be a valid number`);
  }

  return numericValue;
}

function ensurePositiveInteger(value: unknown, field: string): number {
  const numericValue = ensureNumber(value, field);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return numericValue;
}

function ensureBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${field} must be a boolean`);
  }
  return value;
}

function parseTrigger(raw: unknown): StrategyTriggerDefinition {
  if (!isPlainObject(raw)) {
    throw new BadRequestException('Strategy trigger must be an object');
  }

  const type = ensureString(raw.type, 'trigger.type');

  if (type !== 'price') {
    throw new BadRequestException(`Unsupported trigger type "${type}"`);
  }

  const trigger = {
    type: 'price' as const,
    chain: ensureString(raw.chain, 'trigger.chain'),
    tokenAddress: ensureString(raw.tokenAddress, 'trigger.tokenAddress'),
    priceTarget: ensureNumber(raw.priceTarget, 'trigger.priceTarget'),
    comparator: undefined as 'gte' | 'lte' | undefined,
  };

  if (raw.comparator !== undefined) {
    const comparator = ensureString(raw.comparator, 'trigger.comparator').toLowerCase();
    if (comparator !== 'gte' && comparator !== 'lte') {
      throw new BadRequestException('trigger.comparator must be "gte" or "lte"');
    }
    trigger.comparator = comparator;
  }

  return trigger;
}

function parseAction(raw: unknown): TransactionAction {
  if (!isPlainObject(raw)) {
    throw new BadRequestException('Strategy action must be an object');
  }

  const type = ensureString(raw.type, 'action.type').toLowerCase();

  switch (type) {
    case 'swap':
      return {
        type: 'swap',
        chainId: ensureString(raw.chainId, 'action.chainId'),
        assetIn: ensureString(raw.assetIn, 'action.assetIn'),
        assetOut: ensureString(raw.assetOut, 'action.assetOut'),
        amountIn: ensureString(raw.amountIn, 'action.amountIn'),
        slippageBps:
          raw.slippageBps !== undefined
            ? ensureNumber(raw.slippageBps, 'action.slippageBps')
            : undefined,
      };
    case 'bridge':
      return {
        type: 'bridge',
        fromChainId: ensureString(raw.fromChainId, 'action.fromChainId'),
        toChainId: ensureString(raw.toChainId, 'action.toChainId'),
        assetIn: ensureString(raw.assetIn, 'action.assetIn'),
        assetOut: ensureString(raw.assetOut, 'action.assetOut'),
        amountIn: ensureString(raw.amountIn, 'action.amountIn'),
        slippageBps:
          raw.slippageBps !== undefined
            ? ensureNumber(raw.slippageBps, 'action.slippageBps')
            : undefined,
      };
    case 'custom':
      return {
        type: 'custom',
        name: ensureString(raw.name, 'action.name'),
        parameters: isPlainObject(raw.parameters) ? raw.parameters : {},
      };
    default:
      throw new BadRequestException(`Unsupported action type "${type}"`);
  }
}

function parseLegacyDefinition(raw: PlainObject): StrategyDefinition | null {
  if ('trigger' in raw || 'action' in raw) {
    return null;
  }

  if (!('type' in raw) || raw.type !== 'price') {
    return null;
  }

  if (!('chain' in raw) || !('tokenAddress' in raw) || !('priceTarget' in raw)) {
    throw new BadRequestException(
      'Legacy strategy definitions require chain, tokenAddress, and priceTarget fields',
    );
  }

  const comparator =
    raw.comparator !== undefined
      ? ensureString(raw.comparator, 'definition.comparator').toLowerCase()
      : undefined;

  if (comparator && comparator !== 'gte' && comparator !== 'lte') {
    throw new BadRequestException('definition.comparator must be "gte" or "lte"');
  }

  const trigger = {
    type: 'price' as const,
    chain: ensureString(raw.chain, 'definition.chain'),
    tokenAddress: ensureString(raw.tokenAddress, 'definition.tokenAddress'),
    priceTarget: ensureNumber(raw.priceTarget, 'definition.priceTarget'),
    comparator,
  };

  const repeat =
    raw.repeat !== undefined ? ensureBoolean(raw.repeat, 'definition.repeat') : undefined;

  const sessionKeyId =
    raw.sessionKeyId !== undefined
      ? ensurePositiveInteger(raw.sessionKeyId, 'definition.sessionKeyId')
      : undefined;

  return {
    trigger,
    action: {
      type: 'custom',
      name: 'legacy-definition',
      parameters: {
        note: 'Legacy strategy missing explicit action; execution will be skipped.',
      },
    },
    repeat,
    sessionKeyId,
  };
}

export function parseStrategyDefinition(input: unknown): StrategyDefinition {
  if (!isPlainObject(input)) {
    throw new BadRequestException('Strategy definition must be an object');
  }

  const legacyDefinition = parseLegacyDefinition(input);
  if (legacyDefinition) {
    return legacyDefinition;
  }

  if (!('trigger' in input)) {
    throw new BadRequestException('Strategy definition requires a trigger');
  }

  if (!('action' in input)) {
    throw new BadRequestException('Strategy definition requires an action');
  }

  const definition: StrategyDefinition = {
    trigger: parseTrigger(input.trigger),
    action: parseAction(input.action),
      repeat:
        input.repeat !== undefined ? ensureBoolean(input.repeat, 'definition.repeat') : undefined,
      sessionKeyId:
        input.sessionKeyId !== undefined
          ? ensurePositiveInteger(input.sessionKeyId, 'definition.sessionKeyId')
          : undefined,
  };

  return definition;
}
