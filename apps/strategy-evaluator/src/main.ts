import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HealthService } from './health.service';
import * as http from 'http';
import { validateRequiredEnv } from './env.validation';

async function bootstrap() {
  validateRequiredEnv();
  const app = await NestFactory.createApplicationContext(AppModule);
  // Lightweight health server
  try {
    const health = app.get(HealthService);
    const port = Number(
      process.env.STRATEGY_EVALUATOR_PORT ?? process.env.HEALTH_PORT ?? 3003,
    );
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        void health
          .getStatus()
          .catch(() => ({ ok: false }))
          .then((status) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
          })
          .catch(() => {
            res.writeHead(500);
            res.end(JSON.stringify({ ok: false }));
          });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port);
  } catch (error) {
    console.error('Failed to bootstrap application:', error);
    process.exit(1);
  }

  // Keep alive until SIGINT
  await new Promise((resolve) => process.on('SIGINT', resolve));
  await app.close();
}

void bootstrap();
