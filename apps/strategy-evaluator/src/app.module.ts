import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User,
  Wallet,
  Strategy,
  TransactionLog,
  TokenPrice,
  SessionKey,
  STRATEGY_QUEUE,
  TRANSACTION_QUEUE,
} from '@copil/database';

import { StrategyProcessor } from './strategy.processor';
import { AlchemyService } from './alchemy.service';

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
        entities: [User, Wallet, Strategy, TransactionLog, TokenPrice, SessionKey],
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Strategy, TokenPrice, Wallet]),
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
    BullModule.registerQueue({ name: STRATEGY_QUEUE }),
    BullModule.registerQueue({ name: TRANSACTION_QUEUE }),
  ],
  providers: [StrategyProcessor, AlchemyService],
})
export class AppModule {}
