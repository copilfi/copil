import { Injectable, Logger } from '@nestjs/common';

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
}

interface SwapExecutionResult {
  success: boolean;
  txHash?: string;
  description?: string;
}

@Injectable()
export class SwapAggregatorClient {
  private readonly logger = new Logger(SwapAggregatorClient.name);

  async getQuote(_request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    // TODO: integrate 1inch / 0x aggregator for real quotes
    return {
      supported: false,
      warning: 'Swap quotes are not implemented yet.',
    };
  }

  async execute(_request: SwapQuoteRequest): Promise<SwapExecutionResult> {
    this.logger.warn('SwapAggregatorClient.execute called but not implemented.');
    return {
      success: false,
      description: 'Swap execution not implemented yet.',
    };
  }
}
