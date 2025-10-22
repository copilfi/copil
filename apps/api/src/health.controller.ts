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
      { key: 'INTERNAL_API_TOKEN', present: Boolean(process.env.INTERNAL_API_TOKEN) },
      { key: 'PAYMASTER_ENABLED', present: Boolean(process.env.PAYMASTER_ENABLED) },
    ];
    const chat = {
      enabled: (process.env.CHAT_ENABLED || 'false') === 'true',
      hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
      hasGroq: Boolean(process.env.GROQ_API_KEY),
    };
    const solana = {
      jupiterApi: process.env.JUPITER_API_URL || 'https://quote-api.jup.ag',
    };
    const hl = {
      ingestEnabled: (process.env.HL_INGEST_ENABLED || 'true') === 'true',
      ingestSymbols: (process.env.HL_INGEST_SYMBOLS || '').split(',').map((s) => s.trim()).filter(Boolean),
      agent: process.env.HL_AGENT_ADDRESS || null,
      builder: process.env.HL_BUILDER_ADDRESS || null,
      chunking: (process.env.HL_CHUNK_ENABLED || 'false') === 'true',
    };
    const solIngest = {
      enabled: (process.env.SOL_INGEST_ENABLED || 'true') === 'true',
      mints: (process.env.SOL_INGEST_MINTS || '').split(',').map((s) => s.trim()).filter(Boolean),
    };
    const rateLimit = {
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
      limit: parseInt(process.env.RATE_LIMIT_LIMIT || '60', 10),
    };
    const webOrigins = (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',').map((o) => o.trim()).filter(Boolean);
    const rolloutChecklist = [
      'DB/Redis reachable (liveness)',
      'ONEBALANCE_API_KEY configured',
      'INTERNAL_API_TOKEN configured (and Strategy Evaluator uses same)',
      'RPC_URL_<CHAIN> set for executing networks',
      'CHAT_ENABLED + OpenAI/Groq keys (if chat on)',
      'HL ingest enabled + symbol list set',
      'Solana price ingest (optional) configured',
    ];
    return { ok: true, keys, rpc, chat, solana, hyperliquid: hl, solanaIngest: solIngest, rateLimit, webOrigins, rolloutChecklist };
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
