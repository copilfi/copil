import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Strategy, TransactionLog, User, Wallet, SessionKey, TRANSACTION_QUEUE } from '@copil/database';
import { TransactionProcessor } from './transaction.processor';
import { ExecutionService } from './execution/execution.service';
import { SignerService } from './signer/signer.service';
import { BundlerClient } from './clients/bundler.client';
import { PaymasterClient } from './clients/paymaster.client';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { KeyManagementService } from '../../api/src/common/key-management.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        entities: [User, Wallet, Strategy, TransactionLog, SessionKey],
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Strategy, TransactionLog, SessionKey, Wallet]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: TRANSACTION_QUEUE,
    }),
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    ExecutionService,
    TransactionProcessor,
    SignerService,
    BundlerClient,
    PaymasterClient,
    HealthService,
    KeyManagementService,
    {
      provide: ChainAbstractionClient,
      useFactory: (configService: ConfigService) => {
        const apiKey = configService.get<string>('ONEBALANCE_API_KEY');
        if (!apiKey) {
          throw new Error('ONEBALANCE_API_KEY is not defined in environment variables.');
        }
        return new ChainAbstractionClient(apiKey);
      },
      inject: [ConfigService],
    },
  ],
})
export class AppModule {}
