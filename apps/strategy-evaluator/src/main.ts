import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // Application logic will be handled by the BullMQ processors
  // The application will run until it is manually stopped.
}
bootstrap();
