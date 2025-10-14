import { Injectable } from '@nestjs/common';
import { AlchemyService } from './alchemy.service';
import { Network } from 'alchemy-sdk';
import { InjectRepository } from '@nestjs/typeorm';
import { Wallet } from '@copil/database';
import { Repository } from 'typeorm';

@Injectable()
export class PortfolioService {
  constructor(
    private readonly alchemyService: AlchemyService,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  private getNetworkEnum(chain: string): Network | null {
    switch (chain.toLowerCase()) {
      case 'ethereum':
        return Network.ETH_MAINNET;
      case 'base':
        return Network.BASE_MAINNET;
      case 'arbitrum':
        return Network.ARB_MAINNET;
      case 'linea':
        return Network.LINEA_MAINNET;
      default:
        return null;
    }
  }

  async getWalletBalance(address: string, chain: string) {
    const network = this.getNetworkEnum(chain);
    if (!network) {
      throw new Error(`Unsupported chain: ${chain}`);
    }
    const sdk = this.alchemyService.getSdkForNetwork(network);
    const balances = await sdk.core.getTokenBalances(address);
    return {
      chain,
      address,
      tokens: balances.tokenBalances,
    };
  }

  async getPortfolioForUser(userId: number) {
    const wallets = await this.walletRepository.find({ where: { userId } });
    const portfolio = await Promise.all(
      wallets.map(async (wallet) => {
        try {
          return await this.getWalletBalance(wallet.address, wallet.chain);
        } catch (error) {
          // In case a chain is unsupported or another error occurs
          return {
            chain: wallet.chain,
            address: wallet.address,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );
    return portfolio;
  }
}