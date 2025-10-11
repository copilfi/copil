import { Module } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { LiFiConfigService } from './lifi-config.service';

@Module({
  controllers: [TransactionController],
  providers: [TransactionService, LiFiConfigService],
  exports: [TransactionService, LiFiConfigService],
})
export class TransactionModule {}
