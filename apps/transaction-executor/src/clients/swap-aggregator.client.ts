import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

interface TransactionRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
}

interface SwapQuoteRequest {
  chainId: string;
  assetIn: string;
  assetOut: string;
  amountIn: string;
  slippageBps?: number;
}

interface SwapQuoteResponse {
  supported: boolean;
  warning?: string;
  rawQuote?: unknown;
  transactionRequest?: TransactionRequest;
  allowanceTarget?: string;
}

interface SwapExecutionResult {
  success: boolean;
  txHash?: string;
  description?: string;
  transactionRequest?: TransactionRequest;
  allowanceTarget?: string;
  rawQuote?: unknown;
}

@Injectable()
export class SwapAggregatorClient {
  private readonly logger = new Logger(SwapAggregatorClient.name);

  constructor(private readonly configService: ConfigService) {}

  async getQuote(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    const baseUrl = this.getBaseUrl(request.chainId);
    if (!baseUrl) {
      return {
        supported: false,
        warning: `No swap aggregator configured for chain ${request.chainId}.`,
      };
    }

    const url = new URL('/swap/v1/quote', baseUrl);
    url.searchParams.set('sellToken', request.assetIn);
    url.searchParams.set('buyToken', request.assetOut);
    url.searchParams.set('sellAmount', request.amountIn);

    let response: FetchResponse;
    try {
      response = await this.safeFetch(url, {
        headers: this.buildHeaders(),
      });
    } catch (error) {
      return {
        supported: false,
        warning: (error as Error).message,
      };
    }

    if (!response.ok) {
      const text = await response.text();
      this.logger.warn(`Swap quote failed (${response.status}): ${text}`);
      return {
        supported: false,
        warning: `Aggregator quote failed (${response.status}).`,
      };
    }

    const quote = await response.json();
    const transactionRequest = this.extractTransactionRequest(quote);

    return {
      supported: true,
      rawQuote: quote,
      transactionRequest,
      allowanceTarget: quote.allowanceTarget,
    };
  }

  async execute(request: SwapQuoteRequest): Promise<SwapExecutionResult> {
    const quote = await this.getQuote(request);
    if (!quote.supported || !quote.transactionRequest) {
      return {
        success: false,
        description: quote.warning ?? 'Aggregator did not return executable transaction data.',
        rawQuote: quote.rawQuote,
      };
    }

    // The `execute` method's job is to prepare the data for the signer.
    // The actual broadcasting is handled by the SignerService.
    return {
      success: true,
      description: 'Swap transaction prepared for signing.',
      transactionRequest: quote.transactionRequest,
      allowanceTarget: quote.allowanceTarget,
      rawQuote: quote.rawQuote,
    };
  }

  private getBaseUrl(chainId: string): string | undefined {
    const keyed = this.configService.get<string>(
      `SWAP_AGGREGATOR_BASE_URL_${chainId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
    );
    if (keyed) return keyed;
    return this.configService.get<string>('SWAP_AGGREGATOR_BASE_URL');
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = this.configService.get<string>('SWAP_AGGREGATOR_API_KEY');
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private extractTransactionRequest(quote: any): TransactionRequest | undefined {
    if (!quote || typeof quote !== 'object') {
      return undefined;
    }
    const { to, data, value } = quote;
    if (typeof to === 'string' && to.startsWith('0x') && typeof data === 'string' && data.startsWith('0x')) {
      return { to: to as `0x${string}`, data: data as `0x${string}`, value: typeof value === 'string' ? value : undefined };
    }
    return undefined;
  }

  private async safeFetch(url: URL, init: RequestInit): Promise<FetchResponse> {
    try {
      return await fetch(url, init);
    } catch (error) {
      this.logger.error(`Swap aggregator fetch failed: ${(error as Error).message}`);
      throw new Error('Swap aggregator unavailable');
    }
  }
}
