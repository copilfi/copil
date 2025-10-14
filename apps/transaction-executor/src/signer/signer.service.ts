import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWalletClient, http, parseEther, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, arbitrum, linea, mainnet } from 'viem/chains';

export interface SignAndSendRequest {
  userId: number;
  sessionKeyId: number;
  transaction: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: string; // The value in ether, e.g., "0.1"
  };
  metadata?: {
    chain?: string; // e.g., 'base', 'ethereum'
  } & Record<string, unknown>;
}

export interface SignAndSendResult {
  status: 'success' | 'pending' | 'failed';
  txHash?: string;
  description?: string;
}

const chainMap: Record<string, any> = {
  ethereum: mainnet,
  base,
  arbitrum,
  linea,
};

@Injectable()
export class SignerService {
  private readonly logger = new Logger(SignerService.name);

  constructor(private readonly configService: ConfigService) {}

  async signAndSend(request: SignAndSendRequest): Promise<SignAndSendResult> {
    const { sessionKeyId, transaction, metadata } = request;
    const chainName = metadata?.chain ?? 'base'; // Default to base if not provided
    const chain = chainMap[chainName.toLowerCase()];

    if (!chain) {
      return {
        status: 'failed',
        description: `Unsupported chain: ${chainName}`,
      };
    }

    const privateKey = this.getSessionKey(sessionKeyId);
    if (!privateKey) {
      return {
        status: 'failed',
        description: `Private key for session key ID ${sessionKeyId} not found.`,
      };
    }

    const rpcUrl = this.getRpcUrl(chainName);
    if (!rpcUrl) {
      return {
        status: 'failed',
        description: `RPC URL for chain ${chainName} not configured.`,
      };
    }

    try {
      const account = privateKeyToAccount(privateKey);
      const client = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      }).extend(publicActions);

      this.logger.log(
        `Sending transaction on ${chainName} from ${account.address} to ${transaction.to}`,
      );

      const txHash = await client.sendTransaction({
        chain,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value ? parseEther(transaction.value) : undefined,
      });

      this.logger.log(`Transaction successful with hash: ${txHash}`);

      return {
        status: 'success',
        txHash,
        description: `Transaction successfully broadcasted on ${chainName}.`,
      };
    } catch (error) {
      this.logger.error(
        `Error sending transaction for session key ${sessionKeyId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        status: 'failed',
        description: `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private getSessionKey(sessionKeyId: number): `0x${string}` | undefined {
    const key = this.configService.get<string>(
      `SESSION_KEY_${sessionKeyId}_PRIVATE_KEY`,
    );
    if (key) {
      return key.startsWith('0x') ? (key as `0x${string}`) : `0x${key}`;
    }
    const fallback = this.configService.get<string>('SESSION_KEY_PRIVATE_KEY');
    if (fallback) {
      return fallback.startsWith('0x')
        ? (fallback as `0x${string}`)
        : `0x${fallback}`;
    }
    return undefined;
  }

  private getRpcUrl(chain: string): string | undefined {
    const key = `RPC_URL_${chain.toUpperCase()}`;
    return (
      this.configService.get<string>(key) ??
      this.configService.get<string>('RPC_URL')
    );
  }
}