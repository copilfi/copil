import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenPrice } from '@copil/database';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TokenPrice])],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}

