import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Wallet } from '@copil/database';
import { Repository } from 'typeorm';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    private readonly chainAbstractionClient: ChainAbstractionClient,
  ) {}

  async getPortfolioForUser(userId: number) {
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
      return portfolio.balances;
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
