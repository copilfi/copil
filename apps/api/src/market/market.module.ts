import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenPrice, TokenSentiment } from '@copil/database';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TokenPrice, TokenSentiment])],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
