import { Injectable, Logger } from '@nestjs/common';

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
}

interface BridgeExecutionResult {
  success: boolean;
  txHash?: string;
  description?: string;
}

@Injectable()
export class LiFiClient {
  private readonly logger = new Logger(LiFiClient.name);

  async getQuote(_request: BridgeQuoteRequest): Promise<BridgeQuoteResponse> {
    // TODO: integrate LI.FI SDK for actionable quotes
    return {
      supported: false,
      warning: 'Bridge quotes are not implemented yet.',
    };
  }

  async execute(_request: BridgeQuoteRequest): Promise<BridgeExecutionResult> {
    this.logger.warn('LiFiClient.execute called but not implemented.');
    return {
      success: false,
      description: 'Bridge execution not implemented yet.',
    };
  }
}
