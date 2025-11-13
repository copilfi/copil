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
    // Only return non-sensitive system status information
    const requiredChains = [
      'ethereum',
      'base',
      'arbitrum',
      'linea',
      'optimism',
      'polygon',
      'bsc',
      'avalanche',
      'sei',
      'hyperevm',
    ];
    const configuredChains = requiredChains.filter((c) =>
      Boolean(process.env[`RPC_URL_${c.toUpperCase()}`]),
    );

    return {
      ok: true,
      configuredChains,
      chatEnabled: (process.env.CHAT_ENABLED || 'false') === 'true',
      hyperliquidIngestEnabled: (process.env.HL_INGEST_ENABLED || 'true') === 'true',
      solanaIngestEnabled: (process.env.SOL_INGEST_ENABLED || 'true') === 'true',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('cors')
  cors() {
    const webOrigins = (process.env.WEB_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    return { ok: true, allowedOrigins: webOrigins };
  }

  @Get('liveness')
  async liveness() {
    // DB check
    let db = false;
    try {
      await this.dataSource.query('SELECT 1');
      db = true;
    } catch {
      // DB connection failed
    }
    // Queue check
    const queues: Record<string, unknown> = {};
    try {
      const tx = await this.txQueue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
        'paused',
      );
      const st = await this.stratQueue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
        'paused',
      );
      Object.assign(queues, { [TRANSACTION_QUEUE]: tx, [STRATEGY_QUEUE]: st });
    } catch {
      // Queue check failed
    }
    return { ok: db, db, queues };
  }
}
