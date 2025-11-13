import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; body?: unknown }>();
    const token = this.config.get<string>('INTERNAL_API_TOKEN');
    if (!token) return false;

    const providedToken = this.getHeader(req, 'x-service-token');
    const providedSig = this.getHeader(req, 'x-service-signature');
    const providedTs = this.getHeader(req, 'x-service-timestamp');

    if (!providedToken || !providedSig || !providedTs) {
      return false;
    }

    if (!this.safeEquals(providedToken, token)) {
      return false;
    }

    const timestamp = Number(providedTs);
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    const skewMs = Math.abs(Date.now() - timestamp);
    if (skewMs > 60_000) {
      return false; // replay window exceeded
    }

    const payload = JSON.stringify(req.body ?? {});
    const expectedSig = crypto.createHmac('sha256', token).update(`${timestamp}:${payload}`).digest('hex');
    return this.safeEquals(providedSig, expectedSig);
  }

  private getHeader(req: { headers: Record<string, string> }, key: string): string | undefined {
    const val = req.headers[key] ?? req.headers[key.toLowerCase()] ?? req.headers[key.toUpperCase()];
    return typeof val === 'string' ? val : undefined;
  }

  private safeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
