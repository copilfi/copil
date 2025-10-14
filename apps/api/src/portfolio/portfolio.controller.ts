import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';

@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  getPortfolio(@Request() req: AuthRequest) {
    return this.portfolioService.getPortfolioForUser(req.user.id);
  }

  @Get('balance/:chain/:address')
  getWalletBalance(
    @Param('chain') chain: string,
    @Param('address') address: string,
  ) {
    return this.portfolioService.getWalletBalance(address, chain);
  }
}