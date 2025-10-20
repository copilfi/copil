import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());

  // Enable CORS for local web app and configurable origin
  const originsRaw = process.env.WEB_ORIGIN || 'http://localhost:3000';
  const allowedOrigins = originsRaw.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: (reqOrigin, callback) => {
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
bootstrap();
