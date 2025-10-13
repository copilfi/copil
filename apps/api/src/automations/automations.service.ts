import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Strategy,
  STRATEGY_QUEUE,
  TRANSACTION_QUEUE,
  TransactionJobData,
  SessionKey,
} from '@copil/database';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { parseStrategyDefinition } from './strategy-definition.utils';

const DEFAULT_CONDITION_INTERVAL_MS = 60_000;

@Injectable()
export class AutomationsService {
  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
    @InjectQueue(STRATEGY_QUEUE) private readonly strategyQueue: Queue<{ strategyId: number }>,
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly transactionQueue: Queue<TransactionJobData>,
  ) {}

  async create(createStrategyDto: CreateStrategyDto, userId: number): Promise<Strategy> {
    const { definition: rawDefinition, ...rest } = createStrategyDto;
    const definition = parseStrategyDefinition(rawDefinition);

    await this.ensureSessionKeyOwnership(definition.sessionKeyId, userId);

    const strategy = this.strategyRepository.create({
      ...rest,
      definition,
      userId,
    });
    const savedStrategy = await this.strategyRepository.save(strategy);

    if (savedStrategy.isActive) {
      if (savedStrategy.schedule) {
        // Add a repeatable job based on the cron schedule
        await this.strategyQueue.add(
          savedStrategy.name, 
          { strategyId: savedStrategy.id }, 
          { repeat: { pattern: savedStrategy.schedule }, jobId: `strategy:${savedStrategy.id}` }
        );
      } else {
        // Add a repeatable job that runs every minute for condition-based triggers
        await this.strategyQueue.add(savedStrategy.name, { strategyId: savedStrategy.id }, {
          repeat: { every: DEFAULT_CONDITION_INTERVAL_MS },
          jobId: `strategy:${savedStrategy.id}`,
        });
      }
    }

    await this.purgeTransactionJobs(id);
    return savedStrategy;
  }

  findAll(userId: number): Promise<Strategy[]> {
    return this.strategyRepository.find({ where: { userId } });
  }

  async findOne(id: number, userId: number): Promise<Strategy> {
    const strategy = await this.strategyRepository.findOne({ where: { id, userId } });
    if (!strategy) {
      throw new NotFoundException(`Strategy with ID "${id}" not found`);
    }
    return strategy;
  }

  async update(id: number, updateStrategyDto: UpdateStrategyDto, userId: number): Promise<Strategy> {
    const strategy = await this.findOne(id, userId);
    const originalIsActive = strategy.isActive;
    const originalSchedule = strategy.schedule;

    const updates: Partial<Strategy> = { ...updateStrategyDto };
    if (updateStrategyDto.definition !== undefined) {
      updates.definition = parseStrategyDefinition(updateStrategyDto.definition);
      await this.ensureSessionKeyOwnership(updates.definition.sessionKeyId, userId);
    }

    const updated = this.strategyRepository.merge(strategy, updates);
    const savedStrategy = await this.strategyRepository.save(updated);

    const jobId = `strategy:${id}`;

    // Deactivation
    if (originalIsActive && !savedStrategy.isActive) {
      const repeatableJobs = await this.strategyQueue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find(job => job.id === jobId);
      if (jobToRemove) {
        await this.strategyQueue.removeRepeatableByKey(jobToRemove.key);
      }
    }

    // Activation or Schedule Change
    if ((!originalIsActive && savedStrategy.isActive) || (savedStrategy.isActive && originalSchedule !== savedStrategy.schedule)) {
      // Remove old job first in case of schedule change
      const repeatableJobs = await this.strategyQueue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find(job => job.id === jobId);
      if (jobToRemove) {
        await this.strategyQueue.removeRepeatableByKey(jobToRemove.key);
      }

      // Add new job
      if (savedStrategy.schedule) {
        await this.strategyQueue.add(savedStrategy.name, { strategyId: savedStrategy.id }, { repeat: { pattern: savedStrategy.schedule }, jobId });
      } else {
        await this.strategyQueue.add(savedStrategy.name, { strategyId: savedStrategy.id }, { repeat: { every: DEFAULT_CONDITION_INTERVAL_MS }, jobId });
      }
    }

    return savedStrategy;
  }

  async remove(id: number, userId: number): Promise<void> {
    const strategy = await this.findOne(id, userId); // Ensures the user owns the strategy
    
    // Remove the repeatable job from the queue
    const repeatableJobs = await this.strategyQueue.getRepeatableJobs();
    const jobToRemove = repeatableJobs.find(job => job.id === `strategy:${id}`);
    if (jobToRemove) {
      await this.strategyQueue.removeRepeatableByKey(jobToRemove.key);
    }

    await this.strategyRepository.remove(strategy);
    await this.purgeTransactionJobs(id);
  }

  private async purgeTransactionJobs(strategyId: number): Promise<void> {
    const jobStates: Array<'waiting' | 'delayed' | 'active'> = ['waiting', 'delayed', 'active'];
    const jobs = await this.transactionQueue.getJobs(jobStates);

    await Promise.all(
      jobs
        .filter((job) => job.data?.strategyId === strategyId)
        .map(async (job) => {
          try {
            await job.remove();
          } catch (error) {
            // Best-effort cleanup; ignore failures so they do not block user actions.
          }
        }),
    );
  }

  private async ensureSessionKeyOwnership(sessionKeyId: number | undefined, userId: number) {
    if (sessionKeyId === undefined) {
      return;
    }

    const sessionKey = await this.sessionKeyRepository.findOne({ where: { id: sessionKeyId } });
    if (!sessionKey) {
      throw new BadRequestException(`Session key ${sessionKeyId} not found.`);
    }

    if (sessionKey.userId !== userId) {
      throw new BadRequestException('Session key does not belong to the authenticated user.');
    }

    if (!sessionKey.isActive) {
      throw new BadRequestException('Session key is inactive. Reactivate or create a new one.');
    }
  }
}
