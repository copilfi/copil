import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Wallet } from '@copil/database';
import { Repository } from 'typeorm';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private readonly cache = new Map<number, { t: number; data: any }>();

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    private readonly chainAbstractionClient: ChainAbstractionClient,
    private readonly configService: ConfigService,
  ) {}

  async getPortfolioForUser(userId: number) {
    const ttl = parseInt(this.configService.get<string>('PORTFOLIO_CACHE_TTL_MS') || '15000', 10);
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.t < ttl) return hit.data;
    const wallets = await this.walletRepository.find({ where: { userId } });
    if (wallets.length === 0) {
      return [];
    }

    const userAddresses = wallets.map((wallet) => wallet.address);

    try {
      // This single call replaces the previous logic of iterating over each wallet.
      const portfolio = await this.chainAbstractionClient.getAggregatedBalance({
        userAddresses,
      });
      const balances = portfolio.balances;
      this.cache.set(userId, { t: Date.now(), data: balances });
      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to fetch aggregated balance for user ${userId}`,
        error,
      );
      // In case of an error from the abstraction layer, return empty array
      // Frontend expects an array
      return [];
    }
  }
}
