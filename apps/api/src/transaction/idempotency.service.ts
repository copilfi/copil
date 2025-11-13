import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionLog } from '@copil/database';
import { Redis } from 'ioredis';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly redis: Redis;
  private readonly IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours

  constructor(
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: 2,
    });
  }

  async checkAndSetIdempotency(idempotencyKey: string): Promise<{ valid: boolean; reason?: string }> {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return { valid: false, reason: 'Invalid or missing idempotency key' };
    }

    try {
      // Check Redis first for performance
      const existing = await this.redis.get(`idempotency:${idempotencyKey}`);
      if (existing) {
        return { valid: false, reason: 'Duplicate transaction detected' };
      }

      // Check database as backup
      const dbExisting = await this.transactionLogRepository
      .createQueryBuilder('log')
      .where('log.idempotencyKey = :idempotencyKey', { idempotencyKey })
      .getOne();

      if (dbExisting) {
        // Set in Redis for future checks
        await this.redis.setex(`idempotency:${idempotencyKey}`, this.IDEMPOTENCY_TTL, '1');
        return { valid: false, reason: 'Duplicate transaction detected' };
      }

      // Set in Redis to prevent future duplicates
      await this.redis.setex(`idempotency:${idempotencyKey}`, this.IDEMPOTENCY_TTL, '1');

      return { valid: true };
    } catch (error) {
      this.logger.error(`Idempotency check failed: ${(error as Error).message}`);
      // Fail open - allow transaction but log error
      return { valid: true, reason: 'Idempotency check failed, proceeding with caution' };
    }
  }

  async clearIdempotency(idempotencyKey: string): Promise<void> {
    try {
      await this.redis.del(`idempotency:${idempotencyKey}`);
    } catch (error) {
      this.logger.warn(`Failed to clear idempotency key: ${(error as Error).message}`);
    }
  }

  generateIdempotencyKey(userId: number, intent: any): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    const intentHash = this.hashIntent(intent);
    return `${userId}-${timestamp}-${random}-${intentHash}`;
  }

  private hashIntent(intent: any): string {
    const crypto = require('crypto');
    const intentStr = JSON.stringify(intent, Object.keys(intent).sort());
    return crypto.createHash('sha256').update(intentStr).digest('hex').substring(0, 8);
  }
}
