import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const expected = this.config.get<string>('INTERNAL_API_TOKEN');
    if (!expected) return false;
    const provided = req.headers['x-service-token'] || req.headers['X-Service-Token'] as any;
    return Boolean(provided && provided === expected);
  }
}

