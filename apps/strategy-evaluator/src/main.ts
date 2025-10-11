import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  // Prevent the application from exiting immediately
  await new Promise(resolve => process.on('SIGINT', resolve));
  await app.close();
}
bootstrap();
