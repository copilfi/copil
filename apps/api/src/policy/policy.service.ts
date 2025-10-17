import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from '@copil/database';
import { encodeFunctionData } from 'viem';

const SAFE_GUARD_MANAGER_ABI = [
  {
    type: 'function',
    name: 'setGuard',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'guard', type: 'address' }],
    outputs: [],
  },
] as const;

@Injectable()
export class PolicyService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
  ) {}

  async prepareSetGuardTx(userId: number, chain: string) {
    const wallet = await this.walletRepo.findOne({ where: { userId, chain } });
    if (!wallet || !wallet.smartAccountAddress) {
      throw new BadRequestException(`Smart Account for user ${userId} on chain ${chain} not found.`);
    }

    const guardEnv = `SAFE_POLICY_GUARD_ADDRESS_${chain.toUpperCase()}`;
    const guard = process.env[guardEnv];
    if (!guard) {
      throw new BadRequestException(`Guard address not configured. Set ${guardEnv}.`);
    }

    const data = encodeFunctionData({
      abi: SAFE_GUARD_MANAGER_ABI,
      functionName: 'setGuard',
      args: [guard as `0x${string}`],
    });

    // In practice, changing Safe settings requires a Safe transaction (multisig); this tx may need to be wrapped.
    // Here we return a raw call to the Safe's setGuard function for the user to execute via appropriate flow.
    return {
      to: wallet.smartAccountAddress as `0x${string}`,
      data,
      value: '0',
      notes: `Set guard to ${guard} on ${chain}. Execute with your Safe owner(s).`,
    };
  }
}

