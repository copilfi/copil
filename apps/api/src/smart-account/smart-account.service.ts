import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Wallet, TransactionLog, TRANSACTION_QUEUE, TransactionIntent, TransactionJobData } from '@copil/database';
import { SmartAccountService as AddressService } from '../auth/smart-account.service';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';

@Injectable()
export class SmartAccountOrchestratorService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(TransactionLog)
    private readonly txLogRepository: Repository<TransactionLog>,
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly txQueue: Queue<TransactionJobData>,
    private readonly addressService: AddressService,
    private readonly configService: ConfigService,
  ) {}

  async ensureWallet(userId: number, chain: string): Promise<Wallet> {
    const existing = await this.walletRepository.findOne({ where: { userId, chain } });
    if (existing) return existing;
    // Try to derive EOA from any wallet of the user
    const anyWallet = await this.walletRepository.findOne({ where: { userId } });
    if (!anyWallet || !anyWallet.address) {
      throw new NotFoundException('No EOA wallet found for user; cannot derive Smart Account address.');
    }
    const smart = await this.addressService.getSmartAccountAddress(anyWallet.address as `0x${string}`, chain);
    const created = this.walletRepository.create({ userId, chain, address: anyWallet.address, smartAccountAddress: smart });
    return this.walletRepository.save(created);
  }

  async deploy(userId: number, sessionKeyId: number, chain: string) {
    const wallet = await this.ensureWallet(userId, chain);
    if (!wallet.smartAccountAddress) {
      throw new BadRequestException('Smart Account address not available.');
    }

    const quote = {
      id: `deploy-${Date.now()}`,
      fromAmount: '0',
      toAmount: '0',
      transactionRequest: { to: wallet.smartAccountAddress as `0x${string}`, data: '0x', value: '0' },
    } as any;

    const intent: TransactionIntent = { type: 'custom', name: 'deploy', parameters: { chain } };

    const jobData: TransactionJobData = {
      strategyId: null,
      userId,
      sessionKeyId,
      intent,
      quote,
      metadata: { source: 'deploy', chain },
    };

    const job = await this.txQueue.add(`deploy:user:${userId}:${chain}`, jobData, { removeOnComplete: 50, removeOnFail: 200 });
    return { jobId: job.id, smartAccountAddress: wallet.smartAccountAddress };
  }

  private getRpcUrl(chain: string): string {
    const key = `RPC_URL_${chain.toUpperCase()}`;
    const url = this.configService.get<string>(key) ?? this.configService.get<string>('RPC_URL');
    if (!url) throw new BadRequestException(`RPC URL for chain ${chain} not configured.`);
    return url;
  }

  async status(userId: number, chain?: string) {
    const targets = chain
      ? [chain]
      : ['ethereum', 'base', 'arbitrum', 'linea', 'optimism', 'polygon', 'bsc', 'avalanche'];
    const results: any[] = [];
    for (const c of targets) {
      try {
        const wallet = await this.ensureWallet(userId, c);
        const url = this.getRpcUrl(c);
        const client = createPublicClient({ transport: http(url) });
        const code = await client.getBytecode({ address: wallet.smartAccountAddress as `0x${string}` });
        results.push({ chain: c, smartAccountAddress: wallet.smartAccountAddress, deployed: Boolean(code && code !== '0x') });
      } catch (e) {
        results.push({ chain: c, error: (e as Error).message });
      }
    }
    return { results };
  }
}
