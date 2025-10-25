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
  // Require at least one RPC URL for EVM execution
  const chains = ['ETHEREUM','BASE','ARBITRUM','LINEA','OPTIMISM','POLYGON','BSC','AVALANCHE','SEI'];
  const anyRpc = chains.some((c) => Boolean(process.env[`RPC_URL_${c}`]));
  if (!anyRpc) missing.push('RPC_URL_<CHAIN> (at least one of the supported chains)');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
