import { Controller, Get, UseGuards, Request, Post, Body } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from '@copil/database';
import { SmartAccountService as AddressService } from '../auth/smart-account.service';

@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolioService: PortfolioService,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    private readonly addressService: AddressService,
  ) {}

  @Get()
  getPortfolio(@Request() req: AuthRequest) {
    return this.portfolioService.getPortfolioForUser(req.user.id);
  }

  @Post('fund-suggestion')
  async fundSuggestion(
    @Request() req: AuthRequest,
    @Body() body: { targetChain: string; stableSymbol?: string; stableMin?: string; nativeGasMin?: string },
  ) {
    const targetChain = body?.targetChain?.toLowerCase();
    if (!targetChain) {
      throw new Error('targetChain is required');
    }
    const wallets = await this.walletRepo.find({ where: { userId: req.user.id } });
    const eoaSources = wallets.map((w) => ({ chain: w.chain, address: w.address }));
    const safeAddress = await this.addressService.getSmartAccountAddress(eoaSources[0]?.address as `0x${string}`, targetChain);

    // Minimal suggestion: propose bridging from any source EOA to target Safe
    // UI will resolve token addresses and call /transaction/quote or construct transfer
    return {
      destination: { chain: targetChain, smartAccountAddress: safeAddress },
      sources: eoaSources,
      advice: 'Bridge from a source EOA with funds to your Smart Account on the target chain. Use provider comparison to select the best route.',
      desired: { stableSymbol: body.stableSymbol ?? 'USDC', stableMin: body.stableMin ?? '0', nativeGasMin: body.nativeGasMin ?? '0' },
    };
  }

}
