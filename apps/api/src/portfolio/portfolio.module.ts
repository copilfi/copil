import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet, TokenMetadata } from '@copil/database';

import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { SmartAccountService as AddressService } from '../auth/smart-account.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, TokenMetadata])],
  controllers: [PortfolioController],
  providers: [
    PortfolioService,
    AddressService,
    {
      provide: ChainAbstractionClient,
      useFactory: () => {
        console.log('=== DEBUGGING process.env ===');
        console.log('ONEBALANCE_API_KEY:', process.env.ONEBALANCE_API_KEY);
        console.log('DB_HOST:', process.env.DB_HOST);
        console.log('All env vars with ONEBALANCE:', Object.keys(process.env).filter(k => k.includes('ONEBALANCE')));
        console.log('=== END DEBUGGING ===');
        
        const apiKey = process.env.ONEBALANCE_API_KEY;
        if (!apiKey) {
          throw new Error('ONEBALANCE_API_KEY is not defined in environment variables.');
        }
        return new ChainAbstractionClient(apiKey);
      },
    },
  ],
  exports: [PortfolioService, ChainAbstractionClient],
})
export class PortfolioModule {}
