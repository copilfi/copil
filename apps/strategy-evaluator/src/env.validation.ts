export function validateRequiredEnv() {
  const missing: string[] = [];
  for (const k of [
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
  ]) {
    if (!process.env[k]) missing.push(k);
  }
  for (const k of ['REDIS_HOST', 'REDIS_PORT']) {
    if (!process.env[k]) missing.push(k);
  }
  if (!process.env.INTERNAL_API_TOKEN) missing.push('INTERNAL_API_TOKEN');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}
