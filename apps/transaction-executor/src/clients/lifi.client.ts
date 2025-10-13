import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

interface BridgeQuoteRequest {
  fromChainId: string;
  toChainId: string;
  assetIn: string;
  assetOut: string;
  amountIn: string;
  slippageBps?: number;
}

interface TransactionRequest {
  to: string;
  data: string;
  value?: string;
}

interface BridgeQuoteResponse {
  supported: boolean;
  warning?: string;
  rawQuote?: unknown;
  transactionRequest?: TransactionRequest;
}

interface BridgeExecutionResult {
  success: boolean;
  txHash?: string;
  description?: string;
  transactionRequest?: TransactionRequest;
  rawQuote?: unknown;
}

@Injectable()
export class LiFiClient {
  private readonly logger = new Logger(LiFiClient.name);

  constructor(private readonly configService: ConfigService) {}

  async getQuote(request: BridgeQuoteRequest): Promise<BridgeQuoteResponse> {
    const baseUrl = this.configService.get<string>('LIFI_API_BASE_URL') ?? 'https://li.quest/v1';
    const url = new URL('/quote', baseUrl);
    url.searchParams.set('fromChain', request.fromChainId);
    url.searchParams.set('toChain', request.toChainId);
    url.searchParams.set('fromToken', request.assetIn);
    url.searchParams.set('toToken', request.assetOut);
    url.searchParams.set('fromAmount', request.amountIn);

    let response: FetchResponse;
    try {
      response = await this.safeFetch(url);
    } catch (error) {
      return {
        supported: false,
        warning: (error as Error).message,
      };
    }
    if (!response.ok) {
      const text = await response.text();
      this.logger.warn(`LiFi quote failed (${response.status}): ${text}`);
      return {
        supported: false,
        warning: `Bridge quote failed (${response.status}).`,
      };
    }

    const quote = await response.json();
    const transactionRequest = this.extractTransactionRequest(quote);

    return {
      supported: true,
      rawQuote: quote,
      transactionRequest,
    };
  }

  async execute(request: BridgeQuoteRequest): Promise<BridgeExecutionResult> {
    const quote = await this.getQuote(request);
    if (!quote.supported) {
      return {
        success: false,
        description: quote.warning ?? 'Bridge quote unavailable.',
      };
    }

    if (!quote.transactionRequest) {
      return {
        success: false,
        description: 'Bridge quote did not provide executable transaction data.',
        rawQuote: quote.rawQuote,
      };
    }

    return {
      success: false,
      description: 'Bridge transaction prepared; broadcasting not yet implemented.',
      transactionRequest: quote.transactionRequest,
      rawQuote: quote.rawQuote,
    };
  }

  private extractTransactionRequest(quote: any): TransactionRequest | undefined {
    // LI.FI quotes may contain transactionRequest or steps with execution request data.
    const maybeTx = quote?.transactionRequest ?? quote?.estimate?.approval?.transactionRequest;
    if (maybeTx && typeof maybeTx === 'object') {
      const { to, data, value } = maybeTx;
      if (typeof to === 'string' && typeof data === 'string') {
        return { to, data, value: typeof value === 'string' ? value : undefined };
      }
    }
    const steps = Array.isArray(quote?.steps) ? quote.steps : [];
    for (const step of steps) {
      const tx = step?.transactionRequest;
      if (tx && typeof tx.to === 'string' && typeof tx.data === 'string') {
        return { to: tx.to, data: tx.data, value: typeof tx.value === 'string' ? tx.value : undefined };
      }
    }
    return undefined;
  }

  private async safeFetch(url: URL): Promise<FetchResponse> {
    try {
      const headers: Record<string, string> = {};
      const apiKey = this.configService.get<string>('LIFI_API_KEY');
      if (apiKey) {
        headers['x-lifi-api-key'] = apiKey;
      }
      return await fetch(url, { headers });
    } catch (error) {
      this.logger.error(`LiFi fetch failed: ${(error as Error).message}`);
      throw new Error('LiFi service unavailable');
    }
  }
}
