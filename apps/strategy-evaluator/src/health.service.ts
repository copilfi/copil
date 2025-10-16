import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { STRATEGY_QUEUE, TRANSACTION_QUEUE } from '@copil/database';

@Injectable()
export class HealthService {
  constructor(
    @InjectQueue(STRATEGY_QUEUE) private readonly strategyQueue: Queue,
    @InjectQueue(TRANSACTION_QUEUE) private readonly txQueue: Queue,
  ) {}

  async getStatus() {
    const [strategyCounts, txCounts] = await Promise.all([
      this.strategyQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
      this.txQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
    ]);
    return {
      ok: true,
      queues: {
        [STRATEGY_QUEUE]: strategyCounts,
        [TRANSACTION_QUEUE]: txCounts,
      },
    };
  }
}

