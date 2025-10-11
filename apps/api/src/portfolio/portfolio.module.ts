import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { AlchemyService } from './alchemy.service';

@Module({
  controllers: [PortfolioController],
  providers: [PortfolioService, AlchemyService],
  exports: [PortfolioService, AlchemyService],
})
export class PortfolioModule {}
