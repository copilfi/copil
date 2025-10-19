import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionKey, Wallet, TransactionLog, TRANSACTION_QUEUE } from '@copil/database';
import { SessionKeysService } from './session-keys.service';
import { SessionKeysController } from './session-keys.controller';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from '../auth/auth.module';
import { SmartAccountOrchestratorService } from '../smart-account/smart-account.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionKey, Wallet, TransactionLog]),
    BullModule.registerQueue({ name: TRANSACTION_QUEUE }),
    AuthModule,
  ],
  controllers: [SessionKeysController],
  providers: [SessionKeysService, SmartAccountOrchestratorService],
  exports: [SessionKeysService],
})
export class SessionKeysModule {}
