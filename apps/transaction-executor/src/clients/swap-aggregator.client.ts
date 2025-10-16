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
    const candidates = this.getBaseCandidates(request.chainId);
    if (candidates.length === 0) {
      return {
        supported: false,
        warning: `No swap aggregator configured for chain ${request.chainId}.`,
      };
    }

    let lastWarning = '';
    for (const c of candidates) {
      try {
        const url = new URL('/swap/v1/quote', c.baseUrl);
        url.searchParams.set('sellToken', request.assetIn);
        url.searchParams.set('buyToken', request.assetOut);
        url.searchParams.set('sellAmount', request.amountIn);

        const response = await this.safeFetch(url, { headers: c.headers });
        if (!response.ok) {
          const text = await response.text();
          lastWarning = `Provider ${c.label} failed (${response.status}): ${text.slice(0, 200)}`;
          this.logger.warn(lastWarning);
          continue; // try next candidate
        }

        const quote = await response.json();
        const transactionRequest = this.extractTransactionRequest(quote);
        return {
          supported: true,
          rawQuote: quote,
          transactionRequest,
          allowanceTarget: quote.allowanceTarget ?? quote.tx?.to ?? quote.spender,
        };
      } catch (error) {
        lastWarning = `Provider ${c.label} error: ${(error as Error).message}`;
        this.logger.warn(lastWarning);
        continue;
      }
    }

    return { supported: false, warning: lastWarning || 'All aggregators failed' };
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

  private getBaseCandidates(chainId: string): Array<{ baseUrl: string; headers: Record<string, string>; label: string }> {
    const norm = chainId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const primary =
      this.configService.get<string>(`SWAP_AGGREGATOR_BASE_URL_${norm}`) ??
      this.configService.get<string>('SWAP_AGGREGATOR_BASE_URL');
    const alt =
      this.configService.get<string>(`SWAP_AGGREGATOR_ALT_BASE_URL_${norm}`) ??
      this.configService.get<string>('SWAP_AGGREGATOR_ALT_BASE_URL');

    const list: Array<{ baseUrl: string; headers: Record<string, string>; label: string }> = [];
    if (primary) list.push({ baseUrl: primary, headers: this.buildHeaders('primary'), label: 'primary' });
    if (alt) list.push({ baseUrl: alt, headers: this.buildHeaders('alt'), label: 'alt' });
    return list;
  }

  private buildHeaders(which: 'primary' | 'alt'): Record<string, string> {
    const headers: Record<string, string> = {};
    const keyName = which === 'primary' ? 'SWAP_AGGREGATOR_API_KEY' : 'SWAP_AGGREGATOR_ALT_API_KEY';
    const apiKey = this.configService.get<string>(keyName);
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
    const timeoutMs = Number(this.configService.get<string>('SWAP_AGGREGATOR_TIMEOUT_MS') ?? '10000');
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      this.logger.error(`Swap aggregator fetch failed: ${(error as Error).message}`);
      throw new Error('Swap aggregator unavailable');
    } finally {
      clearTimeout(id);
    }
  }
}
