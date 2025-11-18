import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { SignerService } from './signer/signer.service';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly signer: SignerService,
  ) {}

  @Get('health')
  getHealth() {
    return this.health.getStatus();
  }

  @Get('metrics/hyperliquid')
  getHyperliquidMetrics() {
    return this.signer.getHyperliquidMetrics();
  }

  @Get('metrics/evm')
  getEvmMetrics() {
    return this.signer.getEvmMetrics();
  }

  @Get('metrics/solana')
  getSolanaMetrics() {
    return this.signer.getSolanaMetrics();
  }

  @Get('health/readiness')
  readiness() {
    const keys = [
      { key: 'ONEBALANCE_API_KEY', present: Boolean(process.env.ONEBALANCE_API_KEY) },
      { key: 'PIMLICO_API_KEY', present: Boolean(process.env.PIMLICO_API_KEY) },
      { key: 'PAYMASTER_ENABLED', present: Boolean(process.env.PAYMASTER_ENABLED) },
    ];
    const rpcChains = [
      'ethereum',
      'base',
      'arbitrum',
      'linea',
      'optimism',
      'polygon',
      'bsc',
      'avalanche',
      'sei',
    ];
    const rpc = rpcChains.map((c) => ({
      chain: c,
      env: `RPC_URL_${c.toUpperCase()}`,
      present: Boolean(process.env[`RPC_URL_${c.toUpperCase()}`]),
    }));
    const hl = {
      defaultSlippage: process.env.HL_DEFAULT_SLIPPAGE || '0.003',
      chunk: (process.env.HL_CHUNK_ENABLED || 'false') === 'true',
    };
    return { ok: true, keys, rpc, hyperliquid: hl };
  }
}
