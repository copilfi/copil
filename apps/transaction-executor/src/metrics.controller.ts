import { Controller, Get } from '@nestjs/common';
import { SignerService } from './signer/signer.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly signer: SignerService) {}

  @Get('evm')
  evm() {
    return this.signer.getEvmMetrics();
  }

  @Get('solana')
  solana() {
    return this.signer.getSolanaMetrics();
  }

  @Get('hyperliquid')
  hl() {
    return this.signer.getHyperliquidMetrics();
  }
}
