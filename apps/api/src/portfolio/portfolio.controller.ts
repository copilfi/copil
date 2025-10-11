import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('balance/:chain/:address')
  getWalletBalance(
    @Param('chain') chain: string,
    @Param('address') address: string,
  ) {
    return this.portfolioService.getWalletBalance(address, chain);
  }
}
