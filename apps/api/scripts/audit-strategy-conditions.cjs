const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function safeParseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

(async () => {
  const strategies = await prisma.strategy.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      conditions: true,
      updatedAt: true
    }
  });

  const summary = new Map();
  const malformed = [];

  for (const strategy of strategies) {
    const raw = strategy.conditions;
    const parsed = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? safeParseJson(raw)
        : [];

    if (!parsed.length) {
      const emptyEntry = summary.get('<<empty>>') || { total: 0, normalized: 0, sample: [] };
      emptyEntry.total += 1;
      summary.set('<<empty>>', emptyEntry);
      continue;
    }

    for (const condition of parsed) {
      if (!condition || typeof condition !== 'object') {
        malformed.push({ strategyId: strategy.id, value: condition });
        continue;
      }

      const typeKey = String(condition.type ?? '<<missing>>');
      const entry = summary.get(typeKey) || { total: 0, normalized: 0, sample: [] };
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
    const ratio = stats.total ? ((stats.normalized / stats.total) * 100).toFixed(2) : '0.00';
    console.log(`  Normalized %: ${ratio}`);
    stats.sample.forEach((sample, idx) => {
      console.log(`  Sample ${idx + 1}: ${JSON.stringify(sample)}`);
    });
  }

  if (malformed.length) {
    console.log('\nMalformed entries detected:');
    const limited = malformed.slice(0, 10);
    for (const entry of limited) {
      console.log(`  Strategy ${entry.strategyId}: ${JSON.stringify(entry.value)}`);
    }
    if (malformed.length > limited.length) {
      console.log(`  ...and ${malformed.length - limited.length} more`);
    }
  }

  await prisma.$disconnect();
})().catch(async (error) => {
  console.error('Audit failed', error);
  await prisma.$disconnect();
  process.exit(1);
});
