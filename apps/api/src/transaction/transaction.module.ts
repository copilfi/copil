import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionInternalController } from './transaction.internal.controller';
import { TransactionLog, TRANSACTION_QUEUE, TokenMetadata, User, Wallet, Strategy, SessionKey } from '@copil/database';
import { BullModule } from '@nestjs/bull';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { ConfigService } from '@nestjs/config';
import { SolanaService } from '../solana/solana.service';
import { RiskManager } from './risk-manager';
import { IdempotencyService } from './idempotency.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionLog, TokenMetadata, User, Wallet, Strategy, SessionKey]),
    BullModule.registerQueue({
      name: TRANSACTION_QUEUE,
    }),
    PortfolioModule, // Import PortfolioModule to use ChainAbstractionClient
  ],
  controllers: [TransactionController, TransactionInternalController],
  providers: [
    TransactionService,
    SolanaService,
    RiskManager,
    IdempotencyService,
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
