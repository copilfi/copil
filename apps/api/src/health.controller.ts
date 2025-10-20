import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { STRATEGY_QUEUE, TRANSACTION_QUEUE } from '@copil/database';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(TRANSACTION_QUEUE) private readonly txQueue: Queue,
    @InjectQueue(STRATEGY_QUEUE) private readonly stratQueue: Queue,
  ) {}
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

  @Get('liveness')
  async liveness() {
    // DB check
    let db = false;
    try { await this.dataSource.query('SELECT 1'); db = true; } catch {}
    // Queue check
    let queues: any = {};
    try {
      const tx = await this.txQueue.getJobCounts('waiting','active','delayed','failed','completed','paused');
      const st = await this.stratQueue.getJobCounts('waiting','active','delayed','failed','completed','paused');
      queues = { [TRANSACTION_QUEUE]: tx, [STRATEGY_QUEUE]: st };
    } catch {}
    return { ok: db, db, queues };
  }
}
