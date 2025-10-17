import {
  GetAggregatedBalanceRequest,
  GetAggregatedBalanceResponse,
  GetQuoteRequest,
  GetQuoteResponse,
} from './types';

export interface IChainAbstractionClient {
  getAggregatedBalance(
    request: GetAggregatedBalanceRequest,
  ): Promise<GetAggregatedBalanceResponse>;

  getQuote(request: GetQuoteRequest): Promise<GetQuoteResponse>;

}
