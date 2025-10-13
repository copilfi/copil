import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionLog } from '@copil/database';
import { getQuote, QuoteRequest } from '@lifi/sdk';
import { Repository } from 'typeorm';

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
  ) {}

  async getQuote(quoteRequest: Omit<QuoteRequest, 'integrator'>) {
    // The SDK is configured globally by LiFiConfigService
    const quote = await getQuote(quoteRequest);
    return quote;
  }

  async getLogs(userId: number, limit = 20): Promise<TransactionLog[]> {
    return this.transactionLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }
}
