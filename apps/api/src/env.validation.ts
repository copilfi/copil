export function validateRequiredEnv() {
  const missing: string[] = [];

  // Database
  for (const k of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
    if (!process.env[k]) missing.push(k);
  }
  // Redis
  for (const k of ['REDIS_HOST', 'REDIS_PORT']) {
    if (!process.env[k]) missing.push(k);
  }
  // Auth
  const hasJwtSecret = Boolean(process.env.JWT_SECRET);
  const hasPrivy = Boolean(process.env.PRIVY_APP_ID);
  const hasPrivyKey = Boolean(process.env.PRIVY_PUBLIC_KEY_PEM || process.env.PRIVY_JWKS_ENDPOINT);
  if (!hasJwtSecret && !(hasPrivy && hasPrivyKey)) {
    missing.push('JWT_SECRET or (PRIVY_APP_ID + PRIVY_PUBLIC_KEY_PEM|PRIVY_JWKS_ENDPOINT)');
  }
  // Chain abstraction (quotes & balances)
  if (!process.env.ONEBALANCE_API_KEY) {
    missing.push('ONEBALANCE_API_KEY');
  }
  // Chat (optional; only required when CHAT_ENABLED=true)
  if (process.env.CHAT_ENABLED === 'true') {
    if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
      missing.push('OPENAI_API_KEY or GROQ_API_KEY (when CHAT_ENABLED=true)');
    }
  }

  if (missing.length > 0) {
    const list = missing.join(', ');
    throw new Error(`Missing required environment variables: ${list}`);
  }
}
