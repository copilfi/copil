import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HealthService } from './health.service';
import * as http from 'http';
import { validateRequiredEnv } from './env.validation';

async function bootstrap() {
  validateRequiredEnv();
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('TransactionExecutorBootstrap');
  logger.log('Transaction Executor service is running.');

  // Lightweight health server
  try {
    const health = appContext.get(HealthService);
    const port = Number(process.env.TX_EXECUTOR_PORT ?? process.env.HEALTH_PORT ?? 3005);
    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        const status = await health.getStatus().catch(() => ({ ok: false }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port, () => logger.log(`Health server listening on :${port}`));
  } catch (e) {
    logger.warn(`Health server not started: ${(e as Error).message}`);
  }

  appContext.enableShutdownHooks();
}

bootstrap().catch((error) => {
  const logger = new Logger('TransactionExecutorBootstrap');
  logger.error('Fatal error while starting Transaction Executor service', error);
  process.exit(1);
});
