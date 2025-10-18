import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());

  // Enable CORS for local web app and configurable origin
  const origin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin,
    credentials: true,
  });

  const port = parseInt(process.env.PORT || '4311', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
}
bootstrap();
