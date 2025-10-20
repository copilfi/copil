import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    const request = ctx.getRequest<any>();
    const rid = response?.getHeader?.('x-request-id') || request?.headers?.['x-request-id'] || `req-${Date.now()}`;
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? (exception.getResponse() as any) : (exception as any);
    const payload = typeof message === 'string' ? { message } : message;
    const body = {
      ok: false,
      status,
      requestId: rid,
      error: payload?.message ?? payload?.error ?? 'Unexpected error',
      details: payload?.details ?? undefined,
    };
    if (status >= 500) {
      this.logger.error(`HTTP ${status} [${rid}] ${request?.method} ${request?.url}: ${body.error}`);
    }
    try { response.setHeader('x-request-id', rid); } catch {}
    response.status(status).json(body);
  }
}

