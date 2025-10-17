import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { http, createPublicClient, parseEther, Chain, createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, arbitrum, linea, mainnet } from 'viem/chains';
import { entryPoint06Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless/clients';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { BundlerClient } from '../clients/bundler.client';
import { InjectRepository } from '@nestjs/typeorm';
import { Wallet } from '@copil/database';
import { Repository } from 'typeorm';
import { seiChain } from '@copil/chain-abstraction-client'; // Import seiChain

export interface SignAndSendRequest {
  userId: number;
  sessionKeyId: number;
  transaction: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface SignAndSendResult {
  status: 'success' | 'pending' | 'failed';
  txHash?: string;
  description?: string;
}

const chainMap: Record<string, Chain> = {
  ethereum: mainnet,
  base,
  arbitrum,
  linea,
  sei: seiChain, // Add Sei to the map
};

@Injectable()
export class SignerService {
  private readonly logger = new Logger(SignerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly bundlerClient: BundlerClient,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  async signAndSend(request: SignAndSendRequest): Promise<SignAndSendResult> {
    const chainName = (request.metadata?.chain as string) ?? 'base';
    const chain = chainMap[chainName.toLowerCase()];

    if (!chain) {
      return { status: 'failed', description: `Unsupported chain: ${chainName}` };
    }

    if (chain.id === seiChain.id) {
      return this.signAndSendSeiTransaction(chainName, chain, request);
    } else {
      return this.signAndSendEvmTransaction(chainName, chain, request);
    }
  }

  private async signAndSendSeiTransaction(
    chainName: string,
    chain: Chain,
    request: SignAndSendRequest,
  ): Promise<SignAndSendResult> {
    this.logger.log(`Executing a native Sei transaction.`);
    const { sessionKeyId, transaction } = request;

    const sessionKey = this.getSessionKey(sessionKeyId);
    if (!sessionKey) {
      return {
        status: 'failed',
        description: `Private key for session key ID ${sessionKeyId} not found.`,
      };
    }

    try {
      const walletClient = createWalletClient({
        account: privateKeyToAccount(sessionKey),
        chain: chain,
        transport: http(this.getRpcUrl(chainName)),
      });

      this.logger.log(`Sending transaction via native Sei signer to ${transaction.to}`);

      const txHash = await walletClient.sendTransaction({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value ? parseEther(transaction.value) : undefined,
      });

      this.logger.log(`Sei transaction successful with hash: ${txHash}`);

      return {
        status: 'success',
        txHash,
        description: `Sei transaction successfully sent.`,
      };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Sei transaction failed: ${message}`, error);
        return { status: 'failed', description: `Sei transaction failed: ${message}` };
    }
  }

  private async signAndSendEvmTransaction(
    chainName: string,
    chain: Chain,
    request: SignAndSendRequest,
  ): Promise<SignAndSendResult> {
    const { userId, sessionKeyId, transaction } = request;

    const sessionKey = this.getSessionKey(sessionKeyId);
    if (!sessionKey) {
      return {
        status: 'failed',
        description: `Private key for session key ID ${sessionKeyId} not found.`,
      };
    }

    const wallet = await this.walletRepository.findOne({ where: { userId, chain: chainName } });
    if (!wallet || !wallet.smartAccountAddress) {
      return {
        status: 'failed',
        description: `Smart Account for user ${userId} on chain ${chainName} not found.`,
      };
    }

    try {
      const publicClient = createPublicClient({ transport: http(this.getRpcUrl(chainName)) });
      const sessionKeySigner = privateKeyToAccount(sessionKey);

      const safeAccount = await toSafeSmartAccount({
        client: publicClient,
        owners: [sessionKeySigner], // This might need adjustment for proper session key usage
        version: '1.4.1',
        entryPoint: { address: entryPoint06Address, version: '0.6' },
        address: wallet.smartAccountAddress as `0x${string}`,
      });

      const smartAccountClient = createSmartAccountClient({
        account: safeAccount,
        chain,
        bundlerTransport: this.bundlerClient.getTransport(chain),
      });

      this.logger.log(
        `Sending UserOperation via Smart Account ${safeAccount.address} on ${chainName}`,
      );

      const userOpHash = await smartAccountClient.sendTransaction({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value ? parseEther(transaction.value) : undefined,
      });

      this.logger.log(`UserOperation successful with hash: ${userOpHash}`);

      return {
        status: 'success',
        txHash: userOpHash,
        description: `UserOperation successfully sent on ${chainName}.`,
      };
    } catch (error) {
      this.logger.error(
        `Error sending UserOperation for session key ${sessionKeyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        status: 'failed',
        description: `UserOperation failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      };
    }
  }

  private getSessionKey(sessionKeyId: number): `0x${string}` | undefined {
    const key = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY`);
    if (key) {
      return key.startsWith('0x') ? (key as `0x${string}`) : `0x${key}`;
    }
    const fallback = this.configService.get<string>('SESSION_KEY_PRIVATE_KEY');
    if (fallback) {
      return fallback.startsWith('0x') ? (fallback as `0x${string}`) : `0x${fallback}`;
    }
    return undefined;
  }

  private getRpcUrl(chain: string): string {
    const key = `RPC_URL_${chain.toUpperCase()}`;
    const url = this.configService.get<string>(key) ?? this.configService.get<string>('RPC_URL');
    if (!url) {
      throw new Error(`RPC URL for chain ${chain} not configured.`);
    }
    return url;
  }
}
