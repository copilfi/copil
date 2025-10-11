import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from '@copil/database';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';

@Injectable()
export class AutomationsService {
  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectQueue('strategy-queue') private readonly strategyQueue: Queue,
  ) {}

  async create(createStrategyDto: CreateStrategyDto, userId: number): Promise<Strategy> {
    const strategy = this.strategyRepository.create({
      ...createStrategyDto,
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
        await this.strategyQueue.add(
          savedStrategy.name,
          { strategyId: savedStrategy.id },
          { repeat: { every: 60000 }, jobId: `strategy:${savedStrategy.id}` } // 60000 ms = 1 minute
        );
      }
    }

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

    const updated = this.strategyRepository.merge(strategy, updateStrategyDto);
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
        await this.strategyQueue.add(savedStrategy.name, { strategyId: savedStrategy.id }, { repeat: { every: 60000 }, jobId });
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
  }
}
