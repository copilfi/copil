import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('TransactionExecutorBootstrap');
  logger.log('Transaction Executor service is running.');

  appContext.enableShutdownHooks();
}

bootstrap().catch((error) => {
  const logger = new Logger('TransactionExecutorBootstrap');
  logger.error('Fatal error while starting Transaction Executor service', error);
  process.exit(1);
});
