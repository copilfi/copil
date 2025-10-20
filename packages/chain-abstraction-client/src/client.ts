import axios from 'axios';
import { IChainAbstractionClient } from './interface';
import {
  GetAggregatedBalanceRequest,
  GetAggregatedBalanceResponse,
  GetQuoteRequest,
  GetQuoteResponse,
  TransactionIntent,
} from './types';
import { GetAggregatedBalanceResponseSchema, GetQuoteResponseSchema } from './schemas';
import { SeiClient } from './sei-client';
import { AxelarBridgeClient } from './axelar-bridge.client';
import { z } from 'zod';

const SUPPORTED_ONEBALANCE_CHAINS = [
  'ethereum',
  'arbitrum',
  'base',
  'linea',
  'avalanche',
  'hyperevm',
  'solana',
];

const SEI_CHAIN = 'sei';

export class ChainAbstractionClient implements IChainAbstractionClient {
  private onebalanceApiKey: string;
  private onebalanceApiBaseUrl = 'https://be.onebalance.io/api';
  private seiClient: SeiClient;
  private axelarBridge: AxelarBridgeClient;

  constructor(onebalanceApiKey: string) {
    if (!onebalanceApiKey) {
      throw new Error('OneBalance API key is required.');
    }
    this.onebalanceApiKey = onebalanceApiKey;
    this.seiClient = new SeiClient();
    this.axelarBridge = new AxelarBridgeClient();
  }

  private isSei(chain: string): boolean {
    return chain.toLowerCase() === SEI_CHAIN;
  }

  async getAggregatedBalance(
    request: GetAggregatedBalanceRequest,
  ): Promise<GetAggregatedBalanceResponse> {
    const { userAddresses } = request;
    console.log('Fetching aggregated balance for', userAddresses);

    try {
      const response = await axios.get(
        `${this.onebalanceApiBaseUrl}/v3/balances/aggregated-balance`,
        {
          headers: { 'x-api-key': this.onebalanceApiKey },
          params: { account: userAddresses.join(',') },
        },
      );

      // Validate and parse the response
      const validatedData = GetAggregatedBalanceResponseSchema.parse(response.data);
      return validatedData;
    } catch (error) {
      console.error('Error fetching or validating aggregated balance from OneBalance:', error);
      throw new Error('Failed to fetch aggregated balance.');
    }
  }

  async getQuote(request: GetQuoteRequest): Promise<GetQuoteResponse> {
    const { intent } = request;

    if (intent.type !== 'swap' && intent.type !== 'bridge') {
      throw new Error(`Unsupported intent type for getQuote: ${intent.type}`);
    }

    if (this.isSei(intent.fromChain) || this.isSei(intent.toChain)) {
      if (intent.type === 'swap') {
        return this.seiClient.getSwapQuote(intent);
      }
      // Bridge path involving Sei via Axelar gateway
      return this.axelarBridge.getSeiBridgeQuote(intent);
    }
    // Non-Sei paths use OneBalance
    return this.getOneBalanceQuote(intent);
  }

  // Experimental: Get a Li.Fi quote for comparison (does not affect execution flow)
  async getLiFiQuoteForIntent(intent: TransactionIntent): Promise<{ supported: boolean; raw?: any; error?: string; transactionRequest?: any }> {
    try {
      if (intent.type !== 'swap' && intent.type !== 'bridge') {
        return { supported: false, error: 'LiFi comparator supports only swap/bridge intents' };
      }
      const url = new URL('https://li.quest/v1/quote');
      const fromChain = this.mapChainNameToId(intent.fromChain);
      const toChain = this.mapChainNameToId(intent.toChain);
      if (!fromChain || !toChain) {
        return { supported: false, error: 'Unsupported chain mapping for LiFi' };
      }
      url.searchParams.set('fromChain', String(fromChain));
      url.searchParams.set('toChain', String(toChain));
      url.searchParams.set('fromToken', intent.fromToken);
      url.searchParams.set('toToken', intent.toToken);
      url.searchParams.set('fromAmount', intent.fromAmount);
      const dest = (intent as any).destinationAddress as string | undefined;
      if (dest && typeof dest === 'string') {
        url.searchParams.set('toAddress', dest);
      }
      const res = await axios.get(url.toString());
      if (res.status !== 200) {
        return { supported: false, error: `LiFi quote failed (${res.status})` };
      }
      const tx = this.extractTransactionRequest(res.data);
      return { supported: true, raw: res.data, transactionRequest: tx };
    } catch (e) {
      return { supported: false, error: (e as Error).message };
    }
  }

  private extractTransactionRequest(quote: any): any | undefined {
    const isTx = (tx: any) => tx && typeof tx.to === 'string' && tx.to.startsWith('0x') && typeof tx.data === 'string' && tx.data.startsWith('0x');
    const tryTx = quote?.transactionRequest ?? quote?.estimate?.approval?.transactionRequest;
    if (isTx(tryTx)) return tryTx;
    const steps = Array.isArray(quote?.steps) ? quote.steps : [];
    for (const step of steps) {
      if (isTx(step?.transactionRequest)) return step.transactionRequest;
    }
    return undefined;
  }

  private mapChainNameToId(name: string): number | undefined {
    const map: Record<string, number> = {
      ethereum: 1,
      base: 8453,
      arbitrum: 42161,
      linea: 59144,
      optimism: 10,
      polygon: 137,
      bsc: 56,
      avalanche: 43114,
    };
    return map[name.toLowerCase()];
  }

  private async getOneBalanceQuote(
    intent: TransactionIntent,
  ): Promise<GetQuoteResponse> {
    console.log('Getting OneBalance quote for intent:', intent);

    if (intent.type !== 'swap' && intent.type !== 'bridge') {
      throw new Error(`Unsupported intent type for OneBalance quote: ${intent.type}`);
    }

    // Construct the request body for the OneBalance API
    const requestBody: any = {
      accounts: [{ address: intent.userAddress }],
      source: {
        asset: intent.fromToken,
        amount: intent.fromAmount,
      },
      destination: {
        asset: intent.toToken,
      },
      slippageTolerance: typeof (intent as any).slippageBps === 'number' ? (intent as any).slippageBps : 50, // basis points
    };
    if ((intent as any).destinationAddress && typeof (intent as any).destinationAddress === 'string') {
      requestBody.destination.address = (intent as any).destinationAddress;
    }

    try {
      const response = await axios.post(
        `${this.onebalanceApiBaseUrl}/v3/quote`,
        requestBody,
        {
          headers: { 'x-api-key': this.onebalanceApiKey },
        },
      );

      // Validate and parse the response
      const validatedData = GetQuoteResponseSchema.parse(response.data);
      return validatedData;
    } catch (error) {
      console.error('Error getting or validating quote from OneBalance:', error);
      throw new Error('Failed to get quote.');
    }
  }
}
