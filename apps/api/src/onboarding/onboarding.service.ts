import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from '@copil/database';
import { SmartAccountService as AddressService } from '../auth/smart-account.service';
import { SmartAccountOrchestratorService } from '../smart-account/smart-account.service';

const CHAINS = ['ethereum','base','arbitrum','linea','optimism','polygon','bsc','avalanche'];

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    private readonly addressService: AddressService,
    private readonly orchestrator: SmartAccountOrchestratorService,
  ) {}

  async getAddresses(userId: number) {
    const wallets = await this.walletRepo.find({ where: { userId } });
    const eoas = wallets.map(w => ({ chain: w.chain, address: w.address }));

    // Pick a reference EOA (first) to predict SAs on other chains if missing
    const refEOA = wallets[0]?.address as `0x${string}` | undefined;
    const safes: Record<string,string> = {};
    for (const chain of CHAINS) {
      const existing = wallets.find(w => w.chain?.toLowerCase() === chain && w.smartAccountAddress);
      if (existing?.smartAccountAddress) {
        safes[chain] = existing.smartAccountAddress;
        continue;
      }
      if (refEOA) {
        try {
          const addr = await this.addressService.getSmartAccountAddress(refEOA, chain);
          safes[chain] = addr;
        } catch {
          // ignore chain if not supported
        }
      }
    }
    return { eoas, safes };
  }

  async getStatus(userId: number, chain?: string) {
    const { eoas, safes } = await this.getAddresses(userId);
    const status = await this.orchestrator.status(userId, chain);
    return { eoas, safes, status: status.results };
  }

  async recommendChain(userId: number, preferred?: string) {
    const wallets = await this.walletRepo.find({ where: { userId } });
    const available = new Set(wallets.map(w => w.chain?.toLowerCase()));
    const chain = preferred && available.has(preferred.toLowerCase()) ? preferred.toLowerCase() : (wallets[0]?.chain?.toLowerCase() ?? 'base');
    const { safes } = await this.getAddresses(userId);
    return { chain, smartAccountAddress: safes[chain] };
  }
}

