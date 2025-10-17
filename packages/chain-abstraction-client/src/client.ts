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

  constructor(onebalanceApiKey: string) {
    if (!onebalanceApiKey) {
      throw new Error('OneBalance API key is required.');
    }
    this.onebalanceApiKey = onebalanceApiKey;
    this.seiClient = new SeiClient();
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
          params: { accounts: userAddresses.join(',') },
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
      return this.seiClient.getSwapQuote(intent);
    }
    return this.getOneBalanceQuote(intent);
  }

  private async getOneBalanceQuote(
    intent: TransactionIntent,
  ): Promise<GetQuoteResponse> {
    console.log('Getting OneBalance quote for intent:', intent);

    if (intent.type !== 'swap' && intent.type !== 'bridge') {
      throw new Error(`Unsupported intent type for OneBalance quote: ${intent.type}`);
    }

    // Construct the request body for the OneBalance API
    const requestBody = {
      accounts: [{ address: intent.userAddress }],
      source: {
        asset: intent.fromToken,
        amount: intent.fromAmount,
      },
      destination: {
        asset: intent.toToken,
      },
      slippageTolerance: 50, // Default to 0.5% slippage
    };

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
