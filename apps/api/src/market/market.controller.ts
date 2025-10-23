import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MarketService } from './market.service';
import { Throttle } from '@nestjs/throttler';

@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('trending')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  trending(@Query('chain') chain?: string, @Query('limit') limitRaw?: string) {
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    return this.market.getTrending({ chain, limit });
  }
}

