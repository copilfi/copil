import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { TRANSACTION_QUEUE } from '@copil/database';

@Injectable()
export class HealthService {
  constructor(
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly txQueue: Queue,
  ) {}

  async getStatus() {
    const counts = await this.txQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );
    return {
      ok: true,
      queues: {
        [TRANSACTION_QUEUE]: counts,
      },
    };
  }
}

