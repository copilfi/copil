import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Alchemy, Network } from 'alchemy-sdk';

@Injectable()
export class AlchemyService {
  public readonly sdk: Alchemy;

  constructor(private readonly configService: ConfigService) {
    const settings = {
      apiKey: this.configService.get<string>('ALCHEMY_API_KEY')!,
      network: Network.ETH_MAINNET, // Default network, can be made dynamic
    };
    this.sdk = new Alchemy(settings);
  }

  // We can add methods here to interact with the SDK
  // For example, a method to get balances for a specific chain
  getSdkForNetwork(network: Network): Alchemy {
    const settings = {
        apiKey: this.configService.get<string>('ALCHEMY_API_KEY')!,
        network,
    };
    return new Alchemy(settings);
  }
}
