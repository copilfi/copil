import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { STRATEGY_QUEUE } from '@copil/database';

@Injectable()
export class HealthService {
  constructor(
    @InjectQueue(STRATEGY_QUEUE) private readonly strategyQueue: Queue,
  ) {}

  async getStatus() {
    const strategyCounts = await this.strategyQueue.getJobCounts(
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
        [STRATEGY_QUEUE]: strategyCounts,
      },
    };
  }
}
