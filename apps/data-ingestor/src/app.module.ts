import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Wallet, Strategy, TransactionLog, TokenPrice, SessionKey } from '@copil/database';

import { TasksService } from './tasks.service';
import { DexScreenerService } from './dexscreener.service';
import { HealthService } from './health.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
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
    TypeOrmModule.forFeature([TokenPrice]),
  ],
  providers: [TasksService, DexScreenerService, HealthService],
})
export class AppModule {}
