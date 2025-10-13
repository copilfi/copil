import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { TransactionJobData } from './execution/types';
import { ExecutionService } from './execution/execution.service';
import { TRANSACTION_QUEUE } from '@copil/database';

@Processor(TRANSACTION_QUEUE)
export class TransactionProcessor {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(private readonly executionService: ExecutionService) {}

  @Process('*')
  async handle(job: Job<TransactionJobData>): Promise<void> {
    this.logger.debug(
      `Processing transaction job ${job.id} for strategy ${job.data.strategyId} (${job.name})`,
    );

    try {
      await this.executionService.execute(job.data);
      this.logger.debug(`Job ${job.id} completed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Job ${job.id} failed: ${message}`);
      throw error;
    }
  }
}
