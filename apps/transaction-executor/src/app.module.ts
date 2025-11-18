import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

// Database entities
import { User, Wallet, Strategy, TransactionLog, SessionKey, FeeLog } from '@copil/database';

// Services
import { SignerService } from './signer/signer.service';
import { ExecutionService } from './execution/execution.service';
import { EnterpriseKeyManagementService } from './services/enterprise-key-management.service';
import { MockKeyManagementService } from './services/mock-key-management.service';
import { AuditService } from './audit/audit.service';
import { RiskEngine } from './risk/risk-engine';
import { KmsKeyManager } from './security/kms-key-manager';
import { StorageService } from './services/storage.service';
import { TransactionSecurityService } from './services/transaction-security.service';
import { DynamicFeeService } from './services/dynamic-fee.service';

// Constants
const TRANSACTION_QUEUE = 'transactions';

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
        entities: [User, Wallet, Strategy, TransactionLog, SessionKey, FeeLog],
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
        logging: configService.get<string>('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Strategy, TransactionLog, SessionKey, Wallet, FeeLog]),
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
  controllers: [],
  providers: [
    ExecutionService,
    SignerService,
    // NEW: Transaction Security Service
    TransactionSecurityService,
    // NEW: Dynamic Fee Service
    DynamicFeeService,
    // Production Storage Service
    StorageService,
    // Enterprise Security Services (always available, but only used when enterprise mode is enabled)
    AuditService,
    RiskEngine,
    KmsKeyManager,
    EnterpriseKeyManagementService,
    // Feature-flagged Key Management Service
    {
      provide: 'IKeyManagementService',
      useFactory: (
        configService: ConfigService,
        enterpriseService: EnterpriseKeyManagementService,
        mockService: MockKeyManagementService,
      ) => {
        const enterpriseSecurityEnabled =
          configService.get<string>('ENTERPRISE_SECURITY_ENABLED') === 'true';

        if (enterpriseSecurityEnabled) {
          console.log('🔐 Enterprise Security Mode Enabled - Using EnterpriseKeyManagementService');
          return enterpriseService;
        } else {
          console.log(
            '  Development Mode - Using MockKeyManagementService (NOT SECURE FOR PRODUCTION)',
          );
          return mockService;
        }
      },
      inject: [ConfigService, EnterpriseKeyManagementService, MockKeyManagementService],
    },
  ],
})
export class AppModule {}
