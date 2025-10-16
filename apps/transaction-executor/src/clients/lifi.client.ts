import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionRequest } from '../execution/types'; // Use the central, strict type

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

interface BridgeQuoteRequest {
  fromChainId: string;
  toChainId: string;
  assetIn: string;
  assetOut: string;
  amountIn: string;
  slippageBps?: number;
}

interface BridgeQuoteResponse {
  supported: boolean;
  warning?: string;
  rawQuote?: unknown;
  transactionRequest?: TransactionRequest; // main tx
  approvalTransactionRequest?: TransactionRequest; // optional approval tx
  approvalSpender?: string;
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
    const approvalTx = this.extractApprovalTransactionRequest(quote);
    const transactionRequest = this.extractMainTransactionRequest(quote, approvalTx);

    return {
      supported: true,
      rawQuote: quote,
      transactionRequest,
      approvalTransactionRequest: approvalTx,
      approvalSpender: quote?.estimate?.approval?.approvalAddress ?? quote?.estimate?.approval?.spender,
    };
  }

  async execute(request: BridgeQuoteRequest): Promise<BridgeExecutionResult> {
    const quote = await this.getQuote(request);
    if (!quote.supported || !quote.transactionRequest) {
      return {
        success: false,
        description: quote.warning ?? 'Bridge quote did not provide executable transaction data.',
        rawQuote: quote.rawQuote,
      };
    }

    return {
      success: true, // Let the execution service handle the broadcast
      description: 'Bridge transaction prepared for signing.',
      transactionRequest: quote.transactionRequest,
      rawQuote: quote.rawQuote,
    };
  }

  private toTransactionRequest(tx: any): TransactionRequest | undefined {
    if (
      tx &&
      typeof tx.to === 'string' && tx.to.startsWith('0x') &&
      typeof tx.data === 'string' && tx.data.startsWith('0x')
    ) {
      return {
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: typeof tx.value === 'string' ? tx.value : undefined,
      };
    }
    return undefined;
  }

  private extractApprovalTransactionRequest(quote: any): TransactionRequest | undefined {
    const approvalTx = quote?.estimate?.approval?.transactionRequest;
    return this.toTransactionRequest(approvalTx);
  }

  private extractMainTransactionRequest(
    quote: any,
    approvalTx?: TransactionRequest,
  ): TransactionRequest | undefined {
    // Prefer an explicit main transactionRequest if present
    const top = this.toTransactionRequest(quote?.transactionRequest);
    if (top && (!approvalTx || top.to !== approvalTx.to || top.data !== approvalTx.data)) {
      return top;
    }
    const steps = Array.isArray(quote?.steps) ? quote.steps : [];
    for (const step of steps) {
      const stepTx = this.toTransactionRequest(step?.transactionRequest);
      if (stepTx && (!approvalTx || stepTx.to !== approvalTx.to || stepTx.data !== approvalTx.data)) {
        return stepTx;
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
