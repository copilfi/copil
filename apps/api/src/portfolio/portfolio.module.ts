import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { AlchemyService } from './alchemy.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '@copil/database';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet])],
  controllers: [PortfolioController],
  providers: [PortfolioService, AlchemyService],
  exports: [PortfolioService, AlchemyService],
})
export class PortfolioModule {}