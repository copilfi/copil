import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  TransactionLog,
  TRANSACTION_QUEUE,
  TransactionJobData,
  TransactionAction,
} from '@copil/database';
import { getQuote, QuoteRequest } from '@lifi/sdk';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly transactionQueue: Queue<TransactionJobData>,
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

  async createAdHocTransactionJob(
    userId: number,
    sessionKeyId: number,
    action: TransactionAction,
  ): Promise<TransactionJobData> {
    const jobData: TransactionJobData = {
      strategyId: null, // Explicitly set strategyId to null for ad-hoc jobs
      userId,
      sessionKeyId,
      action,
      metadata: {
        source: 'ad-hoc',
        enqueuedAt: new Date().toISOString(),
      },
    };

    const job = await this.transactionQueue.add(`ad-hoc:user:${userId}`, jobData, {
      removeOnComplete: 100,
      removeOnFail: 500,
    });

    this.logger.log(
      `Enqueued ad-hoc transaction job ${job.id} for user ${userId}`,
    );

    return job.data;
  }
}