import crypto from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { validateRequiredEnv } from './env.validation';
import { HttpErrorFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Stricter DTO validation across the app
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());

  // Enable CORS for local web app and configurable origin
  const originsRaw = process.env.WEB_ORIGIN || 'http://localhost:3000';
  const allowedOrigins = originsRaw.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: (reqOrigin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!reqOrigin) return callback(null, true); // non-browser
      if (allowedOrigins.includes(reqOrigin)) return callback(null, true);
      return callback(new Error('CORS origin not allowed'), false);
    },
    credentials: true,
  });

  const port = parseInt(process.env.PORT || '4311', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
}
// Basic process-level guards
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection:', reason);
});

bootstrap();
