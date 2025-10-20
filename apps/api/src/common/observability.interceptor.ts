import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

function genId() {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ObservabilityInterceptor.name);
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { headers: any }>();
    const res = http.getResponse<any>();
    const rid = (req?.headers?.['x-request-id'] as string) || genId();
    if (res?.setHeader) res.setHeader('x-request-id', rid);
    const url = (req as any)?.url || '';
    const method = (req as any)?.method || '';
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.debug(`${method} ${url} completed in ${ms}ms [${rid}]`);
        },
        error: (err) => {
          const ms = Date.now() - start;
          this.logger.warn(`${method} ${url} failed in ${ms}ms [${rid}]: ${(err as Error)?.message}`);
        },
      }),
    );
  }
}

