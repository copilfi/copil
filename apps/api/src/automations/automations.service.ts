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
import { TokenPrice } from '@copil/database';

const DEFAULT_CONDITION_INTERVAL_MS = 60_000;

@Injectable()
export class AutomationsService {
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
    return savedStrategy;
  }

  async diagnose(id: number, userId: number) {
    const strategy = await this.findOne(id, userId);
    const def = strategy.definition as any;
    const trig = def?.trigger as any;
    if (!trig || !trig.type) {
      return { ok: false, reason: 'Trigger missing in definition.' };
    }
    if (trig.type === 'price') {
      const latest = await this.tokenPriceRepository.findOne({ where: { chain: trig.chain, address: trig.tokenAddress }, order: { timestamp: 'DESC' } });
      if (!latest) return { ok: false, type: 'price', reason: 'No TokenPrice data found for chain/token.', chain: trig.chain, tokenAddress: trig.tokenAddress };
      const cmp: 'gte' | 'lte' = trig.comparator ?? 'gte';
      const met = cmp === 'gte' ? Number(latest.priceUsd) >= Number(def.trigger.priceTarget) : Number(latest.priceUsd) <= Number(def.trigger.priceTarget);
      const reason = met ? 'Condition met.' : `Condition not met: latest=${Number(latest.priceUsd)} ${cmp} target=${Number(def.trigger.priceTarget)} is false.`;
      return { ok: true, type: 'price', met, comparator: cmp, latestPrice: Number(latest.priceUsd), target: Number(def.trigger.priceTarget), at: latest.timestamp, reason };
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
