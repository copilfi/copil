import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { ok: true };
  }

  @Get('readiness')
  readiness() {
    const requiredChains = ['ethereum','base','arbitrum','linea','optimism','polygon','bsc','avalanche','sei','hyperevm'];
    const rpc = requiredChains.map((c) => ({ chain: c, env: `RPC_URL_${c.toUpperCase()}`, present: Boolean(process.env[`RPC_URL_${c.toUpperCase()}`]) }));
    const keys = [
      { key: 'ONEBALANCE_API_KEY', present: Boolean(process.env.ONEBALANCE_API_KEY) },
      { key: 'PIMLICO_API_KEY', present: Boolean(process.env.PIMLICO_API_KEY) },
      { key: 'PAYMASTER_ENABLED', present: Boolean(process.env.PAYMASTER_ENABLED) },
    ];
    const rateLimit = {
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
      limit: parseInt(process.env.RATE_LIMIT_LIMIT || '60', 10),
    };
    const webOrigins = (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',').map((o) => o.trim()).filter(Boolean);
    return { ok: true, keys, rpc, rateLimit, webOrigins };
  }

  @Get('cors')
  cors() {
    const webOrigins = (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',').map((o) => o.trim()).filter(Boolean);
    return { ok: true, allowedOrigins: webOrigins };
  }
}
