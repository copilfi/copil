import {
  GetAggregatedBalanceRequest,
  GetAggregatedBalanceResponse,
  GetQuoteRequest,
  GetQuoteResponse,
  TransactionIntent,
} from './types';

export interface IChainAbstractionClient {
  getAggregatedBalance(
    request: GetAggregatedBalanceRequest,
  ): Promise<GetAggregatedBalanceResponse>;

  getQuote(request: GetQuoteRequest): Promise<GetQuoteResponse>;

  prepareTransfer(intent: TransactionIntent): Promise<GetQuoteResponse>;

}
