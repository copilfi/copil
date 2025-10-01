import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../src/utils/logger';
import {
  createConditionCache,
  normalizeStrategyConditions
} from '../src/utils/strategyConditionNormalizer';

const prisma = new PrismaClient();

interface RawCondition extends Record<string, unknown> {}

function isJsonArray(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonArray {
  return Array.isArray(value);
}

function parseConditions(conditions: Prisma.JsonValue | null | undefined): RawCondition[] {
  if (!conditions) {
    return [];
  }

  if (isJsonArray(conditions)) {
    return conditions as RawCondition[];
  }

  if (typeof conditions === 'string') {
    try {
      const parsed = JSON.parse(conditions);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logger.warn(`Failed to parse string conditions: ${(error as Error).message}`);
      return [];
    }
  }

  return [];
}

async function run(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const cache = createConditionCache();
  const context = {
    prisma,
    blockchainService: {
      registerTokenMetadata: (_address: string, _symbol?: string) => {
        // noop for backfill – runtime service populates metadata during execution
      }
    },
    cache
  };

  const strategies = await prisma.strategy.findMany();

  let processed = 0;
  let updated = 0;
  let skippedConditions = 0;

  for (const strategy of strategies) {
    processed += 1;

    const rawConditions = parseConditions(strategy.conditions);

    if (!rawConditions.length) {
      continue;
    }

    try {
      const { normalized, changed, skipped } = await normalizeStrategyConditions(
        strategy.id,
        rawConditions,
        context
      );

      skippedConditions += skipped;

      if (!changed) {
        continue;
      }

      updated += 1;

      if (dryRun) {
        logger.info(`DRY-RUN: Strategy ${strategy.id} would be updated with ${normalized.length} normalized condition(s).`);
        continue;
      }

      await prisma.strategy.update({
        where: { id: strategy.id },
        data: {
          conditions: normalized as unknown as Prisma.JsonArray
        }
      });

      logger.info(`✅ Normalized conditions for strategy ${strategy.id}`);
    } catch (error) {
      logger.error(`❌ Failed to normalize strategy ${strategy.id}:`, error as Error);
    }
  }

  logger.info('--- Strategy Condition Backfill Summary ---');
  logger.info(`Processed strategies : ${processed}`);
  logger.info(`Updated strategies   : ${updated}`);
  logger.info(`Skipped conditions   : ${skippedConditions}`);
  logger.info(`Mode                 : ${dryRun ? 'DRY-RUN' : 'APPLIED'}`);
}

run()
  .catch(error => {
    logger.error('Strategy condition backfill failed:', error as Error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
