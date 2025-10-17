import { BadRequestException } from '@nestjs/common';
import {
  StrategyDefinition,
  StrategyTriggerDefinition,
  TransactionIntent, // Changed from TransactionAction
  PriceComparator,
  PriceTriggerDefinition,
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

  let comparator: PriceComparator | undefined;
  if (raw.comparator !== undefined) {
    const comparatorValue = ensureString(raw.comparator, 'trigger.comparator').toLowerCase();
    if (comparatorValue !== 'gte' && comparatorValue !== 'lte') {
      throw new BadRequestException('trigger.comparator must be "gte" or "lte"');
    }
    comparator = comparatorValue as PriceComparator;
  }

  return {
    type: 'price',
    chain: ensureString(raw.chain, 'trigger.chain'),
    tokenAddress: ensureString(raw.tokenAddress, 'trigger.tokenAddress'),
    priceTarget: ensureNumber(raw.priceTarget, 'trigger.priceTarget'),
    comparator,
  } satisfies PriceTriggerDefinition;
}

// Renamed from parseAction to parseIntent
function parseIntent(raw: unknown): TransactionIntent {
  if (!isPlainObject(raw)) {
    throw new BadRequestException('Strategy intent must be an object');
  }

  const type = ensureString(raw.type, 'intent.type').toLowerCase();

  switch (type) {
    case 'swap':
    case 'bridge': // Treat swap and bridge similarly as per new TransactionIntent
      return {
        type: type as 'swap' | 'bridge',
        fromChain: ensureString(raw.fromChain, 'intent.fromChain'),
        toChain: ensureString(raw.toChain, 'intent.toChain'),
        fromToken: ensureString(raw.fromToken, 'intent.fromToken'),
        toToken: ensureString(raw.toToken, 'intent.toToken'),
        fromAmount: ensureString(raw.fromAmount, 'intent.fromAmount'),
        userAddress: ensureString(raw.userAddress, 'intent.userAddress'),
      };
    case 'custom':
      return {
        type: 'custom',
        name: ensureString(raw.name, 'intent.name'),
        parameters: isPlainObject(raw.parameters) ? raw.parameters : {},
      };
    default:
      throw new BadRequestException(`Unsupported intent type "${type}"`);
  }
}

function parseLegacyDefinition(raw: PlainObject): StrategyDefinition | null {
  if ('trigger' in raw || 'intent' in raw || 'action' in raw) { // Check for both new and old properties
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

  const comparatorValue =
    raw.comparator !== undefined
      ? ensureString(raw.comparator, 'definition.comparator').toLowerCase()
      : undefined;

  if (comparatorValue && comparatorValue !== 'gte' && comparatorValue !== 'lte') {
    throw new BadRequestException('definition.comparator must be "gte" or "lte"');
  }

  const trigger: PriceTriggerDefinition = {
    type: 'price',
    chain: ensureString(raw.chain, 'definition.chain'),
    tokenAddress: ensureString(raw.tokenAddress, 'definition.tokenAddress'),
    priceTarget: ensureNumber(raw.priceTarget, 'definition.priceTarget'),
    comparator: comparatorValue as PriceComparator | undefined,
  };

  const repeat =
    raw.repeat !== undefined ? ensureBoolean(raw.repeat, 'definition.repeat') : undefined;

  const sessionKeyId =
    raw.sessionKeyId !== undefined
      ? ensurePositiveInteger(raw.sessionKeyId, 'definition.sessionKeyId')
      : undefined;

  return {
    trigger,
    intent: { // Changed from action to intent
      type: 'custom',
      name: 'legacy-definition',
      parameters: {
        note: 'Legacy strategy missing explicit intent; execution will be skipped.',
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

  if (!('intent' in input)) { // Changed from action to intent
    throw new BadRequestException('Strategy definition requires an intent');
  }

  const definition: StrategyDefinition = {
    trigger: parseTrigger(input.trigger),
    intent: parseIntent(input.intent), // Changed from action to intent
      repeat:
        input.repeat !== undefined ? ensureBoolean(input.repeat, 'definition.repeat') : undefined,
      sessionKeyId:
        input.sessionKeyId !== undefined
          ? ensurePositiveInteger(input.sessionKeyId, 'definition.sessionKeyId')
          : undefined,
  };

  return definition;
}
