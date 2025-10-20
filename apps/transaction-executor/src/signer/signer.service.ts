import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { http, createPublicClient, parseEther, Chain, createWalletClient, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, arbitrum, linea, mainnet, optimism, polygon, bsc, avalanche } from 'viem/chains';
import { entryPoint06Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless/clients';
import { toSafeSmartAccount } from 'permissionless/accounts';
import * as solana from '@solana/web3.js';
import { BundlerClient } from '../clients/bundler.client';
import { PaymasterClient } from '../clients/paymaster.client';
import { InjectRepository } from '@nestjs/typeorm';
import { Wallet } from '@copil/database';
import { Repository } from 'typeorm';
import { seiChain, hyperliquidChain } from '@copil/chain-abstraction-client';

export interface SignAndSendRequest {
  userId: number;
  sessionKeyId: number;
  wallet: Wallet; // Pass the full wallet context
  transaction: {
    to: `0x${string}` | string; // Allow string for Solana
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

// EVM chains for viem
const chainMap: Record<string, Chain> = {
  ethereum: mainnet, base, arbitrum, linea, optimism, polygon, bsc, avalanche, sei: seiChain, hyperliquid: hyperliquidChain,
};

const SOLANA_CHAIN_NAME = 'solana';

@Injectable()
export class SignerService {
  private readonly logger = new Logger(SignerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly bundlerClient: BundlerClient,
    private readonly paymasterClient: PaymasterClient,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  /**
   * Main dispatcher for signing transactions. It checks the wallet type and delegates to the appropriate method.
   */
  async signAndSend(request: SignAndSendRequest): Promise<SignAndSendResult> {
    if (request.wallet.type === 'eoa') {
      return this.signAndSendEoa(request);
    }
    return this.signAndSendSmartAccount(request);
  }

  private async signAndSendEoa(request: SignAndSendRequest): Promise<SignAndSendResult> {
    const chainName = (request.metadata?.chain as string)?.toLowerCase();
    if (!chainName) {
      return { status: 'failed', description: 'Chain name not provided in metadata.' };
    }

    if (chainName === SOLANA_CHAIN_NAME) {
      return this.signAndSendSolana(request);
    } 

    // Handle EVM-based EOA chains (Sei, Hyperliquid, etc.)
    const chain = chainMap[chainName];
    if (chain) {
      return this.signAndSendEoaEvm(chainName, chain, request);
    }

    return { status: 'failed', description: `Unsupported EOA chain: ${chainName}` };
  }


  private async signAndSendEoaEvm(
    chainName: string,
    chain: Chain,
    request: SignAndSendRequest,
  ): Promise<SignAndSendResult> {
    this.logger.log(`Executing an EOA transaction on EVM chain ${chainName}`);
    const { sessionKeyId, transaction } = request;

    const sessionKey = this.getSessionKey(sessionKeyId);
    if (!sessionKey) {
      return { status: 'failed', description: `Private key for session key ID ${sessionKeyId} not found.` };
    }

    try {
      const walletClient = createWalletClient({
        account: privateKeyToAccount(sessionKey),
        chain: chain,
        transport: http(this.getRpcUrl(chainName)),
      });

      this.logger.log(`Sending transaction via EOA signer to ${transaction.to} on ${chainName}`);

      const txHash = await walletClient.sendTransaction({
        to: transaction.to as `0x${string}`,
        data: transaction.data,
        value: transaction.value ? parseEther(transaction.value) : undefined,
      });

      this.logger.log(`${chainName} EOA transaction successful with hash: ${txHash}`);
      return { status: 'success', txHash, description: `${chainName} EOA transaction successfully sent.` };

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`${chainName} EOA transaction failed: ${message}`, error);
      return { status: 'failed', description: `${chainName} EOA transaction failed: ${message}` };
    }
  }

  private async signAndSendSolana(request: SignAndSendRequest): Promise<SignAndSendResult> {
    this.logger.log('Executing an EOA transaction on Solana');
    const { sessionKeyId, transaction } = request;
    const chainName = SOLANA_CHAIN_NAME;

    const sessionKey = this.getSessionKeyBytes(sessionKeyId); // Expecting byte array for Solana
    if (!sessionKey) {
      return { status: 'failed', description: `Private key for session key ID ${sessionKeyId} not found or invalid.` };
    }

    try {
      const connection = new solana.Connection(this.getRpcUrl(chainName), 'confirmed');
      const signer = solana.Keypair.fromSecretKey(sessionKey);

      const tx = new solana.Transaction();
      
      // This is a simplified example for a native SOL transfer.
      // For SPL tokens or swaps, this logic would need to be much more complex,
      // decoding the intent from the `chain-abstraction-client` quote.
      tx.add(
        solana.SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: new solana.PublicKey(transaction.to),
          lamports: solana.LAMPORTS_PER_SOL * parseFloat(transaction.value || '0'),
        }),
      );
      
      const txHash = await solana.sendAndConfirmTransaction(connection, tx, [signer]);
      
      this.logger.log(`Solana EOA transaction successful with hash: ${txHash}`);
      return { status: 'success', txHash, description: `Solana EOA transaction successfully sent.` };

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Solana EOA transaction failed: ${message}`, error);
      return { status: 'failed', description: `Solana EOA transaction failed: ${message}` };
    }
  }

  private async signAndSendSmartAccount(
    request: SignAndSendRequest,
  ): Promise<SignAndSendResult> {
    const { userId, sessionKeyId, transaction, wallet } = request;
    const chainName = (request.metadata?.chain as string) ?? 'base';
    const chain = chainMap[chainName.toLowerCase()];

    if (!wallet || !wallet.smartAccountAddress) {
      return { status: 'failed', description: `Smart Account for user ${userId} on chain ${chainName} not found.` };
    }

    const sessionKey = this.getSessionKey(sessionKeyId);
    if (!sessionKey) {
      return { status: 'failed', description: `Private key for session key ID ${sessionKeyId} not found.` };
    }

    try {
      const publicClient = createPublicClient({ 
        transport: http(this.getRpcUrl(chainName)),
        chain: chain, // Add chain to publicClient
      });
      const sessionKeySigner = privateKeyToAccount(sessionKey);

      const safeAccount = await toSafeSmartAccount({
        client: publicClient, 
        owners: [sessionKeySigner], 
        version: '1.4.1', 
        entryPoint: { address: entryPoint06Address, version: '0.6' },
        address: wallet.smartAccountAddress as `0x${string}`,
      });

      const usePaymaster = this.configService.get<string>('PAYMASTER_ENABLED') === 'true';
      const baseConfig: any = { account: safeAccount, chain, bundlerTransport: this.bundlerClient.getTransport(chain) };

      if (usePaymaster) {
        try {
          baseConfig.paymasterTransport = this.paymasterClient.getTransport(chain);
          this.logger.log(`Paymaster transport configured for ${chainName}`);
        } catch (e) {
          this.logger.warn(`Paymaster disabled for ${chainName}: ${(e as Error).message}`);
        }
      }

      const smartAccountClient = createSmartAccountClient(baseConfig);

      this.logger.log(`Sending UserOperation via Smart Account ${safeAccount.address} on ${chainName}`);

      const userOpHash = await smartAccountClient.sendTransaction({
        account: safeAccount,
        chain,
        to: transaction.to as `0x${string}`,
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending UserOperation for session key ${sessionKeyId}: ${message}`, error);
      return { status: 'failed', description: `UserOperation failed: ${message}` };
    }
  }

  private getSessionKey(sessionKeyId: number): Hex | undefined {
    const key = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY`);
    if (key) {
      return key.startsWith('0x') ? (key as Hex) : `0x${key}`;
    }
    const fallback = this.configService.get<string>('SESSION_KEY_PRIVATE_KEY');
    if (fallback) {
      return fallback.startsWith('0x') ? (fallback as Hex) : `0x${fallback}`;
    }
    return undefined;
  } 
  
  private getSessionKeyBytes(sessionKeyId: number): Uint8Array | undefined {
    const key = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY_BYTES`);
    if (key) {
        try {
            return Uint8Array.from(JSON.parse(key));
        } catch (e) {
            this.logger.error('Failed to parse SESSION_KEY_..._PRIVATE_KEY_BYTES');
            return undefined;
        }
    }
    // Add fallback for base58 string for Solana, etc.
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
