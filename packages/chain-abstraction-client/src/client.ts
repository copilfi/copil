import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import { IChainAbstractionClient } from './interface';
import {
  GetAggregatedBalanceRequest,
  GetAggregatedBalanceResponse,
  GetQuoteRequest,
  GetQuoteResponse,
  TransactionIntent,
  Quote,
} from './types';
import { GetAggregatedBalanceResponseSchema, GetQuoteResponseSchema } from './schemas';
import { SeiClient } from './sei-client';
import { AxelarBridgeClient } from './axelar-bridge.client';
import { JupiterClient } from './jupiter.client';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { encodeFunctionData } from 'viem';
import { z } from 'zod';


const ERC20_ABI_SLIM = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [ { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' } ], outputs: [ { name: '', type: 'bool' } ] },
] as const;

const SEI_CHAIN = 'sei';
const SOLANA_CHAIN = 'solana';

export class ChainAbstractionClient implements IChainAbstractionClient {
  private onebalanceApiKey: string;
  private onebalanceApiBaseUrl = 'https://be.onebalance.io/api';
  private seiClient: SeiClient;
  private axelarBridge: AxelarBridgeClient;
  private jupiterClient: JupiterClient;
  private http: AxiosInstance;

  constructor(onebalanceApiKey: string) {
    if (!onebalanceApiKey) {
      throw new Error('OneBalance API key is required.');
    }
    this.onebalanceApiKey = onebalanceApiKey;
    this.seiClient = new SeiClient();
    this.axelarBridge = new AxelarBridgeClient();
    const keepAlive = (name: string, def: number) => Number(process.env[name] ?? def);
    this.http = axios.create({
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: keepAlive('HTTP_MAX_SOCKETS', 50) }),
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: keepAlive('HTTPS_MAX_SOCKETS', 50) }),
      timeout: Number(process.env.HTTP_CLIENT_TIMEOUT_MS ?? '12000'),
    });
    this.jupiterClient = new JupiterClient(this.http);
  }

  private isSei(chain: string): boolean {
    return chain.toLowerCase() === SEI_CHAIN;
  }

  private isSolana(chain: string): boolean {
    return chain.toLowerCase() === SOLANA_CHAIN;
  }

  private getRpcUrl(chain: string): string {
    const key = `RPC_URL_${chain.toUpperCase()}`;
    const url = process.env[key] ?? process.env.RPC_URL;
    if (!url) {
      throw new Error(`RPC URL for chain ${chain} not configured.`);
    }
    return url;
  }

  async getAggregatedBalance(
    request: GetAggregatedBalanceRequest,
  ): Promise<GetAggregatedBalanceResponse> {
    const { userAddresses } = request;
    console.log('Fetching aggregated balance for', userAddresses);

    try {
      const response = await this.http.get(
        `${this.onebalanceApiBaseUrl}/v3/balances/aggregated-balance`,
        {
          headers: { 'x-api-key': this.onebalanceApiKey },
          params: { account: userAddresses.join(',') },
          timeout: Number(process.env.ONEBALANCE_TIMEOUT_MS ?? '10000'),
        },
      );

      const validatedData = GetAggregatedBalanceResponseSchema.parse(response.data);
      return validatedData;
    } catch (error) {
      console.error('Error fetching or validating aggregated balance from OneBalance:', error);
      throw new Error('Failed to fetch aggregated balance.');
    }
  }

  async getQuote(request: GetQuoteRequest): Promise<GetQuoteResponse> {
    const { intent } = request;

    if (intent.type === 'swap') {
      if (this.isSolana(intent.fromChain)) {
        return this.getJupiterSwapQuote(intent);
      } else if (this.isSei(intent.fromChain)) {
        return this.seiClient.getSwapQuote(intent);
      } else {
        return this.getOneBalanceQuote(intent);
      }
    } else if (intent.type === 'bridge') {
      if (this.isSei(intent.fromChain) || this.isSei(intent.toChain)) {
        return this.axelarBridge.getSeiBridgeQuote(intent);
      } else if (!this.isSolana(intent.fromChain) && !this.isSolana(intent.toChain)) {
        return this.getLiFiBridgeQuote(intent);
      }
      return this.getOneBalanceQuote(intent);
    } else {
        throw new Error(`Unsupported intent type for getQuote: ${intent.type}`);
    }
  }

  async prepareTransfer(intent: TransactionIntent): Promise<GetQuoteResponse> {
    if (intent.type !== 'transfer') {
      throw new Error('Invalid intent type for prepareTransfer');
    }
    if (this.isSolana(intent.chain)) {
      return this.prepareSolanaTransfer(intent);
    } else {
      return this.prepareEvmTransfer(intent);
    }
  }

  private async getJupiterSwapQuote(intent: TransactionIntent): Promise<GetQuoteResponse> {
    if (intent.type !== 'swap') throw new Error('Invalid intent type');
    const { serializedTx, error } = await this.jupiterClient.getSwapTransaction(intent, intent.userAddress);
    if (error || !serializedTx) {
        throw new Error(`Failed to get Solana swap quote: ${error}`);
    }
    const quote: Quote = {
        id: `jup-${Date.now()}`,
        fromAmount: intent.fromAmount,
        toAmount: '0', 
        serializedTx: serializedTx,
        transactionRequest: null,
    };
    return { quote };
  }

  private async getLiFiBridgeQuote(intent: TransactionIntent): Promise<GetQuoteResponse> {
    console.log('Getting LI.FI bridge quote for intent:', intent);
    if (intent.type !== 'bridge') throw new Error('Invalid intent type for LI.FI bridge');

    try {
      const url = new URL('https://li.quest/v1/quote');
      url.searchParams.set('fromChain', this.mapChainNameToId(intent.fromChain)?.toString() ?? '');
      url.searchParams.set('toChain', this.mapChainNameToId(intent.toChain)?.toString() ?? '');
      url.searchParams.set('fromToken', intent.fromToken);
      url.searchParams.set('toToken', intent.toToken);
      url.searchParams.set('fromAmount', intent.fromAmount);
      url.searchParams.set('fromAddress', intent.userAddress);

      const res = await this.http.get(url.toString(), { timeout: Number(process.env.LIFI_TIMEOUT_MS ?? '10000') });

      if (res.status !== 200 || !res.data.transactionRequest) {
        throw new Error(`Li.Fi quote response did not include a transactionRequest. Route may be too complex.`);
      }

      const quote: Quote = {
        id: res.data.id,
        fromAmount: res.data.estimate.fromAmount,
        toAmount: res.data.estimate.toAmount,
        gasCostUsd: res.data.estimate.gasCosts.find((g: any) => g.type === 'source')?.amountUSD,
        transactionRequest: res.data.transactionRequest,
      };

      return { quote };

    } catch (e) {
      const error = e as Error;
      console.error('Error getting or validating quote from LI.FI:', error);
      throw new Error(`Failed to get LI.FI quote: ${error.message}`);
    }
  }

  private mapChainNameToId(name: string): number | undefined {
    const map: Record<string, number> = {
      ethereum: 1, base: 8453, arbitrum: 42161, linea: 59144, optimism: 10, polygon: 137, bsc: 56, avalanche: 43114,
    };
    return map[name.toLowerCase()];
  }

  private async getOneBalanceQuote(intent: TransactionIntent): Promise<GetQuoteResponse> {
    console.log('Getting OneBalance quote for intent:', intent);
    if (intent.type !== 'swap' && intent.type !== 'bridge') {
      throw new Error(`Unsupported intent type for OneBalance quote: ${intent.type}`);
    }

    const requestBody: any = {
      accounts: [{ address: intent.userAddress }],
      source: { asset: intent.fromToken, amount: intent.fromAmount },
      destination: { asset: intent.toToken },
      slippageTolerance: typeof (intent as any).slippageBps === 'number' ? (intent as any).slippageBps : 50,
    };
    if ((intent as any).destinationAddress) {
      requestBody.destination.address = (intent as any).destinationAddress;
    }

    const feeBps = Number(process.env.ONEBALANCE_FEE_BPS);
    const feeRecipient = process.env.ONEBALANCE_FEE_RECIPIENT;
    if (feeBps > 0 && feeRecipient) {
      requestBody.integratorFee = { feeRecipient: feeRecipient, feeBps: feeBps };
      console.log(`Added integrator fee: ${feeBps} bps to ${feeRecipient}`);
    }

    try {
      const response = await this.http.post(
        `${this.onebalanceApiBaseUrl}/v3/quote`,
        requestBody,
        { headers: { 'x-api-key': this.onebalanceApiKey }, timeout: Number(process.env.ONEBALANCE_TIMEOUT_MS ?? '10000') },
      );

      const validatedData = GetQuoteResponseSchema.parse(response.data);
      return validatedData;
    } catch (error) {
      console.error('Error getting or validating quote from OneBalance:', error);
      throw new Error('Failed to get quote.');
    }
  }

  private async prepareEvmTransfer(intent: TransactionIntent): Promise<GetQuoteResponse> {
    if (intent.type !== 'transfer') throw new Error('Invalid intent');

    const data = encodeFunctionData({
      abi: ERC20_ABI_SLIM,
      functionName: 'transfer',
      args: [intent.toAddress as `0x${string}`, BigInt(intent.amount)],
    });

    const quote: Quote = {
      id: `transfer-${Date.now()}`,
      fromAmount: intent.amount,
      toAmount: intent.amount,
      transactionRequest: { to: intent.tokenAddress as `0x${string}`, data, value: '0' },
    };
    return { quote };
  }

  private async prepareSolanaTransfer(intent: TransactionIntent): Promise<GetQuoteResponse> {
    if (intent.type !== 'transfer') throw new Error('Invalid intent');

    const connection = new Connection(this.getRpcUrl(intent.chain), 'confirmed');
    const fromPubkey = new PublicKey(intent.fromAddress);
    const toPubkey = new PublicKey(intent.toAddress);
    const tokenMintPubkey = new PublicKey(intent.tokenAddress);

    if (intent.tokenAddress.toLowerCase() === 'native') {
        const lamports = BigInt(intent.amount);
        const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey, toPubkey, lamports }));
        const quote: Quote = {
            id: `sol-transfer-${Date.now()}`,
            fromAmount: intent.amount,
            toAmount: intent.amount,
            serializedTx: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
            transactionRequest: null,
        };
        return { quote };
    }

    const fromAta = await getAssociatedTokenAddress(tokenMintPubkey, fromPubkey);
    const toAta = await getAssociatedTokenAddress(tokenMintPubkey, toPubkey);

    const instructions = [createTransferInstruction(fromAta, toAta, fromPubkey, BigInt(intent.amount))];

    const transaction = new Transaction().add(...instructions);
    transaction.feePayer = fromPubkey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const serializedTx = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

    const quote: Quote = {
      id: `spl-transfer-${Date.now()}`,
      fromAmount: intent.amount,
      toAmount: intent.amount,
      serializedTx: serializedTx,
      transactionRequest: null,
    };

    return { quote };
  }
}
