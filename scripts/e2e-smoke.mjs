/*
  Simple smoke script that verifies service health endpoints.
  Usage: node scripts/e2e-smoke.mjs
*/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, { timeoutMs = 30000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }
  throw lastErr ?? new Error('Timeout');
}

async function main() {
  const api = process.env.API_BASE_URL || 'http://localhost:4311';
  const strat = `http://localhost:${process.env.STRATEGY_EVALUATOR_PORT || process.env.HEALTH_PORT || 3003}`;
  const ingestor = `http://localhost:${process.env.DATA_INGESTOR_PORT || process.env.HEALTH_PORT || 3004}`;
  const executor = `http://localhost:${process.env.TX_EXECUTOR_PORT || process.env.HEALTH_PORT || 3005}`;

  const targets = [
    `${api}/health`,
    `${strat}/health`,
    `${ingestor}/health`,
    `${executor}/health`,
  ];

  for (const url of targets) {
    process.stdout.write(`Waiting for ${url} ... `);
    await waitFor(url);
    console.log('OK');
  }

  console.log('All health checks passed.');
}

main().catch((e) => {
  console.error('Smoke test failed:', e?.message || e);
  process.exit(1);
});
