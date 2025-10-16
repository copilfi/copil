import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenMetadata } from '@copil/database';
import { AlchemyService } from './alchemy.service';
import { Network } from 'alchemy-sdk';

@Injectable()
export class TokenMetadataService {
  constructor(
    @InjectRepository(TokenMetadata)
    private readonly repo: Repository<TokenMetadata>,
    private readonly alchemy: AlchemyService,
  ) {}

  private toNetwork(chain: string): Network | null {
    switch (chain.toLowerCase()) {
      case 'ethereum': return Network.ETH_MAINNET;
      case 'base': return Network.BASE_MAINNET;
      case 'arbitrum': return Network.ARB_MAINNET;
      case 'linea': return Network.LINEA_MAINNET;
      default: return null;
    }
  }

  async get(chain: string, address: string): Promise<{ symbol: string | null; decimals: number | null }> {
    const existing = await this.repo.findOne({ where: { chain, address } });
    if (existing) {
      return { symbol: existing.symbol, decimals: existing.decimals };
    }

    const network = this.toNetwork(chain);
    if (!network) return { symbol: null, decimals: null };

    try {
      const sdk = this.alchemy.getSdkForNetwork(network);
      const md = await sdk.core.getTokenMetadata(address);
      const symbol = md.symbol ?? null;
      const decimals = typeof md.decimals === 'number' ? md.decimals : null;
      const row = this.repo.create({ chain, address, symbol, decimals });
      await this.repo.save(row);
      return { symbol, decimals };
    } catch {
      return { symbol: null, decimals: null };
    }
  }
}

