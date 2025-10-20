import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { TransactionModule } from './transaction/transaction.module';
import { AutomationsModule } from './automations/automations.module';
import { SessionKeysModule } from './session-keys/session-keys.module';

import { User, Wallet, Strategy, TransactionLog, TokenPrice, SessionKey, TokenMetadata } from '@copil/database';
import { PolicyController } from './policy/policy.controller';
import { PolicyService } from './policy/policy.service';
import { SmartAccountController } from './smart-account/smart-account.controller';
import { SmartAccountOrchestratorService } from './smart-account/smart-account.service';
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigService available throughout the app
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: parseInt(config.get<string>('RATE_LIMIT_TTL') || '60', 10), limit: parseInt(config.get<string>('RATE_LIMIT_LIMIT') || '60', 10) }],
      }),
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
        entities: [User, Wallet, Strategy, TransactionLog, TokenPrice, SessionKey, TokenMetadata],
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
    TypeOrmModule.forFeature([Wallet, TransactionLog]),
    BullModule.registerQueue({
      name: 'transaction-queue',
    }),
  ],
  controllers: [AppController, HealthController, PolicyController, SmartAccountController, OnboardingController],
  providers: [
    AppService,
    PolicyService,
    SmartAccountOrchestratorService,
    OnboardingService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
