import { HttpModule } from '@nestjs/axios';
import * as http from 'http';
import * as https from 'https';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Strategy,
  TokenPrice,
  Wallet,
  User,
  TransactionLog,
  SessionKey,
  TokenMetadata,
  STRATEGY_QUEUE,
} from '@copil/database';
import { StrategyProcessor } from './strategy.processor';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot(),
    HttpModule.registerAsync({
      useFactory: () => {
        const max = Number(process.env.HTTP_MAX_SOCKETS ?? '50');
        const timeout = Number(process.env.API_HTTP_TIMEOUT_MS ?? '12000');
        return {
          timeout,
          maxRedirects: 0,
          httpAgent: new http.Agent({ keepAlive: true, maxSockets: max }),
          httpsAgent: new https.Agent({ keepAlive: true, maxSockets: max }),
        } as any;
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        entities: [
          User,
          Strategy,
          TokenPrice,
          Wallet,
          TransactionLog,
          SessionKey,
          TokenMetadata,
        ],
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, Strategy, TokenPrice, Wallet]),
    BullModule.forRoot({
      url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
    }),
    BullModule.registerQueue({ name: STRATEGY_QUEUE }),
  ],
  controllers: [HealthController],
  providers: [StrategyProcessor, HealthService],
})
export class AppModule {}
