import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { SignerService } from './signer/signer.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService, private readonly signer: SignerService) {}

  @Get('health')
  getHealth() {
    return this.health.getStatus();
  }

  @Get('metrics/hyperliquid')
  getHyperliquidMetrics() {
    return this.signer.getHyperliquidMetrics();
  }
}

