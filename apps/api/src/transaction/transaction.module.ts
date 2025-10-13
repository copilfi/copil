import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { LiFiConfigService } from './lifi-config.service';
import { TransactionLog } from '@copil/database';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionLog])],
  controllers: [TransactionController],
  providers: [TransactionService, LiFiConfigService],
  exports: [TransactionService, LiFiConfigService],
})
export class TransactionModule {}
