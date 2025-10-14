import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { LiFiConfigService } from './lifi-config.service';
import { TransactionLog, TRANSACTION_QUEUE } from '@copil/database';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionLog]),
    BullModule.registerQueue({
      name: TRANSACTION_QUEUE,
    }),
  ],
  controllers: [TransactionController],
  providers: [TransactionService, LiFiConfigService],
  exports: [TransactionService, LiFiConfigService],
})
export class TransactionModule {}
