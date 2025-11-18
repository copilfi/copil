export function validateRequiredEnv() {
  const missing: string[] = [];
  for (const k of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
    if (!process.env[k]) missing.push(k);
  }
  for (const k of ['REDIS_HOST', 'REDIS_PORT']) {
    if (!process.env[k]) missing.push(k);
  }
  if (!process.env.ONEBALANCE_API_KEY) missing.push('ONEBALANCE_API_KEY');
  if (!process.env.PIMLICO_API_KEY) missing.push('PIMLICO_API_KEY');

  // Enterprise Security - Optional but recommended for production
  const enterpriseSecurityEnabled = process.env.ENTERPRISE_SECURITY_ENABLED === 'true';
  if (enterpriseSecurityEnabled) {
    if (!process.env.AWS_REGION) missing.push('AWS_REGION (required for enterprise security)');
    if (!process.env.AWS_ACCESS_KEY_ID)
      missing.push('AWS_ACCESS_KEY_ID (required for enterprise security)');
    if (!process.env.AWS_SECRET_ACCESS_KEY)
      missing.push('AWS_SECRET_ACCESS_KEY (required for enterprise security)');
  }

  // Require at least one RPC URL for EVM execution
  const chains = [
    'ETHEREUM',
    'BASE',
    'ARBITRUM',
    'LINEA',
    'OPTIMISM',
    'POLYGON',
    'BSC',
    'AVALANCHE',
    'SEI',
  ];
  const anyRpc = chains.some((c) => Boolean(process.env[`RPC_URL_${c}`]));
  if (!anyRpc) missing.push('RPC_URL_<CHAIN> (at least one of the supported chains)');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
