import { Injectable } from '@nestjs/common';
import { AlchemyService } from './alchemy.service';
import { Network } from 'alchemy-sdk';

@Injectable()
export class PortfolioService {
  constructor(private readonly alchemyService: AlchemyService) {}

  private getNetworkEnum(chain: string): Network {
    switch (chain.toLowerCase()) {
      case 'ethereum':
        return Network.ETH_MAINNET;
      case 'base':
        return Network.BASE_MAINNET;
      case 'arbitrum':
        return Network.ARB_MAINNET;
      case 'linea':
          return Network.LINEA_MAINNET;
      // Add other supported chains here
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  async getWalletBalance(address: string, chain: string) {
    const network = this.getNetworkEnum(chain);
    const sdk = this.alchemyService.getSdkForNetwork(network);
    const balances = await sdk.core.getTokenBalances(address);
    return balances;
  }
}
