import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Condition = Record<string, any>;

async function main() {
  const strategies = await prisma.strategy.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      conditions: true,
      updatedAt: true
    }
  });

  const summary = new Map<string, { total: number; normalized: number; sample: Condition[] }>();
  const malformed: Array<{ strategyId: string; value: unknown }> = [];

  for (const strategy of strategies) {
    const raw = strategy.conditions;
    const parsed: Condition[] = Array.isArray(raw)
      ? raw as Condition[]
      : typeof raw === 'string'
        ? safeParseJson<Condition[]>(raw)
        : [];

    if (!parsed.length) {
      summary.set('<<empty>>', { total: (summary.get('<<empty>>')?.total ?? 0) + 1, normalized: 0, sample: [] });
      continue;
    }

    for (const condition of parsed) {
      if (!condition || typeof condition !== 'object') {
        malformed.push({ strategyId: strategy.id, value: condition });
        continue;
      }

      const typeKey = String(condition.type ?? '<<missing>>');
      const entry = summary.get(typeKey) ?? { total: 0, normalized: 0, sample: [] };
      entry.total += 1;
      if (condition.normalized === true) {
        entry.normalized += 1;
      }
      if (entry.sample.length < 3) {
        entry.sample.push(condition);
      }
      summary.set(typeKey, entry);
    }
  }

  console.log('\nStrategy Condition Audit');
  console.log('==========================');
  console.log(`Total strategies: ${strategies.length}`);
  console.log(`Unique condition types: ${summary.size}`);

  for (const [type, stats] of summary) {
    console.log(`\nType: ${type}`);
    console.log(`  Conditions: ${stats.total}`);
    console.log(`  Normalized: ${stats.normalized}`);
    const ratio = stats.total ? (stats.normalized / stats.total * 100).toFixed(2) : '0.00';
    console.log(`  Normalized %: ${ratio}`);
    stats.sample.forEach((sample, idx) => {
      console.log(`  Sample ${idx + 1}: ${JSON.stringify(sample)}`);
    });
  }

  if (malformed.length) {
    console.log('\nMalformed entries detected:');
    for (const entry of malformed.slice(0, 10)) {
      console.log(`  Strategy ${entry.strategyId}: ${JSON.stringify(entry.value)}`);
    }
    if (malformed.length > 10) {
      console.log(`  ...and ${malformed.length - 10} more`);
    }
  }
}

function safeParseJson<T>(value: string): T | [] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T : [];
  } catch {
    return [];
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    console.error('Audit failed', error);
    prisma.$disconnect().finally(() => process.exit(1));
  });
