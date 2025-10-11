import { Injectable } from '@nestjs/common';
import { getQuote, QuoteRequest } from '@lifi/sdk';

@Injectable()
export class TransactionService {
  constructor() {}

  async getQuote(quoteRequest: Omit<QuoteRequest, 'integrator'>) {
    // The SDK is configured globally by LiFiConfigService
    const quote = await getQuote(quoteRequest);
    return quote;
  }
}
