import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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
import { TokenPrice } from '@copil/database';
import { RedisLockService } from '../common/redis-lock.service';
import { PriceOracleService } from '../market/price-oracle.service';

const DEFAULT_CONDITION_INTERVAL_MS = 60_000;

@Injectable()
export class AutomationsService {
  private readonly redisLockService: RedisLockService;

  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
    @InjectRepository(TokenPrice)
    private readonly tokenPriceRepository: Repository<TokenPrice>,
    @InjectQueue(STRATEGY_QUEUE) private readonly strategyQueue: Queue<{ strategyId: number }>,
    @InjectQueue(TRANSACTION_QUEUE)
    private readonly transactionQueue: Queue<TransactionJobData>,
    private readonly priceOracleService: PriceOracleService,
  ) {
    // Initialize RedisLockService with the strategy queue
    this.redisLockService = new RedisLockService(this.strategyQueue as any);
  }

  async create(createStrategyDto: CreateStrategyDto, userId: number): Promise<Strategy> {
    const { definition: rawDefinition, ...rest } = createStrategyDto;
    const definition = parseStrategyDefinition(rawDefinition);

    await this.ensureSessionKeyOwnership(definition.sessionKeyId, userId);

    // Create a hash of strategy definition to prevent duplicates
    const strategyHash = this.hashStrategyDefinition(userId, definition);
    const lockKey = `strategy:create:${strategyHash}`;

    // Try to acquire lock to prevent duplicate strategy creation
    const lockToken = await this.redisLockService.acquireLock(lockKey, 5000);
    if (!lockToken) {
      throw new ConflictException('A similar strategy is already being created. Please wait and try again.');
    }

    try {
      // Check if identical strategy already exists
      const existingStrategies = await this.strategyRepository.find({
        where: { userId, isActive: true }
      });

      for (const existing of existingStrategies) {
        if (this.areStrategiesIdentical(existing.definition as any, definition)) {
          throw new ConflictException('An identical active strategy already exists.');
        }
      }

      const strategy = this.strategyRepository.create({
        ...rest,
        definition,
        userId,
      });
      const savedStrategy = await this.strategyRepository.save(strategy);

      if (savedStrategy.isActive) {
        // Use another lock to prevent duplicate job creation
        const jobLockKey = `strategy:job:${savedStrategy.id}`;
        const jobLockToken = await this.redisLockService.acquireLock(jobLockKey, 3000);

        if (jobLockToken) {
          try {
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
          } finally {
            await this.redisLockService.releaseLock(jobLockKey, jobLockToken);
          }
        }
      }
      return savedStrategy;
    } finally {
      await this.redisLockService.releaseLock(lockKey, lockToken);
    }
  }

  private hashStrategyDefinition(userId: number, definition: any): string {
    // Create a unique hash based on key strategy parameters
    const key = `${userId}-${JSON.stringify(definition.trigger)}-${JSON.stringify(definition.intent)}`;
    return Buffer.from(key).toString('base64').substring(0, 32);
  }

  private areStrategiesIdentical(def1: any, def2: any): boolean {
    // Compare trigger and intent to determine if strategies are identical
    return JSON.stringify(def1.trigger) === JSON.stringify(def2.trigger) &&
           JSON.stringify(def1.intent) === JSON.stringify(def2.intent);
  }

  async diagnose(id: number, userId: number) {
    const strategy = await this.findOne(id, userId);
    const def = strategy.definition as any;
    const trig = def?.trigger as any;
    if (!trig || !trig.type) {
      return { ok: false, reason: 'Trigger missing in definition.' };
    }
    if (trig.type === 'price') {
      const cmp: 'gte' | 'lte' = trig.comparator ?? 'gte';
      const targetPrice = Number(def.trigger.priceTarget);

      try {
        // Use price oracle for validated price with TWAP and circuit breaker
        const validation = await this.priceOracleService.validatePriceTrigger(
          trig.chain,
          trig.tokenAddress,
          targetPrice,
          cmp
        );

        if (!validation.safe) {
          return {
            ok: true,
            type: 'price',
            met: false,
            comparator: cmp,
            latestPrice: validation.currentPrice,
            target: targetPrice,
            twap: validation.twap,
            safe: false,
            warnings: validation.warnings,
            reason: `Trigger met but BLOCKED for safety: ${validation.warnings.join(', ')}`
          };
        }

        const reason = validation.triggered
          ? `Condition met. Price: $${validation.currentPrice}, TWAP: $${validation.twap?.toFixed(4) || 'N/A'}`
          : `Condition not met: latest=$${validation.currentPrice} ${cmp} target=$${targetPrice} is false.`;

        return {
          ok: true,
          type: 'price',
          met: validation.triggered && validation.safe,
          comparator: cmp,
          latestPrice: validation.currentPrice,
          target: targetPrice,
          twap: validation.twap,
          safe: validation.safe,
          warnings: validation.warnings,
          reason
        };
      } catch (error) {
        return {
          ok: false,
          type: 'price',
          reason: `Price validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          chain: trig.chain,
          tokenAddress: trig.tokenAddress
        };
      }
    }
    if (trig.type === 'trend') {
      const top = Math.max(1, Math.min(Number(trig.top ?? 10), 50));
      const chain = String(trig.chain).toLowerCase();
      const addr = String(trig.tokenAddress).toLowerCase();
      const rows = await this.tokenPriceRepository.find({ where: { chain }, order: { timestamp: 'DESC' }, take: Math.max(top * 10, 100) });
      const seen = new Set<string>();
      let rank = -1;
      let pos = 0;
      for (const r of rows) {
        const key = `${r.chain.toLowerCase()}|${r.address.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pos += 1;
        if (r.address.toLowerCase() === addr) { rank = pos; break; }
        if (pos >= top) break;
      }
      const inTop = rank > 0 && rank <= top;
      const reason = inTop ? `Token is within top ${top} (rank ${rank}).` : `Token is not within top ${top}.`;
      return { ok: true, type: 'trend', top, inTop, rank: inTop ? rank : null, reason };
    }
    return { ok: false, reason: `Unsupported trigger type ${trig.type}` };
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

    const updates: Partial<Strategy> = {
      name: updateStrategyDto.name,
      schedule: updateStrategyDto.schedule,
      isActive: updateStrategyDto.isActive,
    };

    let parsedDefinition: Strategy['definition'] | undefined;
    if (updateStrategyDto.definition !== undefined) {
      parsedDefinition = parseStrategyDefinition(updateStrategyDto.definition);
      await this.ensureSessionKeyOwnership(parsedDefinition.sessionKeyId, userId);
    }

    const updated = this.strategyRepository.merge(strategy, {
      ...updates,
      ...(parsedDefinition ? { definition: parsedDefinition } : {}),
    });
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
      throw new BadRequestException('Session key ID is required for transaction execution.');
    }

    const sessionKey = await this.sessionKeyRepository.findOne({ where: { id: String(sessionKeyId) } });
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
