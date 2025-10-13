import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { TransactionModule } from './transaction/transaction.module';
import { AutomationsModule } from './automations/automations.module';
import { SessionKeysModule } from './session-keys/session-keys.module';

import { User, Wallet, Strategy, TransactionLog, TokenPrice, SessionKey } from '@copil/database';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigService available throughout the app
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
        entities: [User, Wallet, Strategy, TransactionLog, TokenPrice, SessionKey],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false, // Disable auto-schema sync, we will use migrations
      }),
      inject: [ConfigService],
    }),
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
    AuthModule,
    ChatModule,
    PortfolioModule,
    TransactionModule,
    AutomationsModule,
    SessionKeysModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
