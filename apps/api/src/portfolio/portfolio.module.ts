import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet, TokenMetadata } from '@copil/database';

import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, TokenMetadata])],
  controllers: [PortfolioController],
  providers: [
    PortfolioService,
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
  exports: [PortfolioService, ChainAbstractionClient],
})
export class PortfolioModule {}
