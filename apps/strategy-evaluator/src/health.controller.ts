import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth() {
    return { ok: true };
  }

  @Get('readiness')
  readiness() {
    const apiUrl = process.env.API_SERVICE_URL || 'http://localhost:4311';
    const token = Boolean(process.env.INTERNAL_API_TOKEN);
    const http = {
      maxSockets: Number(process.env.HTTP_MAX_SOCKETS || '50'),
      timeoutMs: Number(process.env.API_HTTP_TIMEOUT_MS || '12000'),
    };
    return { ok: true, apiUrl, internalToken: token, http };
  }

  @Get('liveness')
  async liveness() {
    return this.health.getStatus();
  }
}

