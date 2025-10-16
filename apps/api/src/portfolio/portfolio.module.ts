import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { AlchemyService } from './alchemy.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet, TokenMetadata } from '@copil/database';
import { TokenMetadataService } from './token-metadata.service';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, TokenMetadata])],
  controllers: [PortfolioController],
  providers: [PortfolioService, AlchemyService, TokenMetadataService],
  exports: [PortfolioService, AlchemyService, TokenMetadataService],
})
export class PortfolioModule {}
