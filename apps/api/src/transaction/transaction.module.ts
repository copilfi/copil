import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionLog, TRANSACTION_QUEUE } from '@copil/database';
import { BullModule } from '@nestjs/bull';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionLog]),
    BullModule.registerQueue({
      name: TRANSACTION_QUEUE,
    }),
    PortfolioModule, // Import PortfolioModule to use ChainAbstractionClient
  ],
  controllers: [TransactionController],
  providers: [
    TransactionService,
    {
      provide: ChainAbstractionClient,
      useFactory: (configService: ConfigService) => {
        const apiKey = configService.get<string>('ONEBALANCE_API_KEY');
        if (!apiKey) {
          throw new Error('ONEBALANCE_API_KEY is not defined in environment variables.');
        }
        return new ChainAbstractionClient(apiKey);
      },
      inject: [ConfigService],
    },
  ],
  exports: [TransactionService, ChainAbstractionClient],
})
export class TransactionModule {}
