import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionLog, TRANSACTION_QUEUE } from '@copil/database';
import { BullModule } from '@nestjs/bull';
import { PortfolioModule } from '../portfolio/portfolio.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionLog]),
    BullModule.registerQueue({
      name: TRANSACTION_QUEUE,
    }),
    PortfolioModule, // Import PortfolioModule to use ChainAbstractionClient
  ],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
