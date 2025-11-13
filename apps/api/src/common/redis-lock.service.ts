import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import Redis from 'ioredis';

/**
 * Distributed lock service using Redis to prevent race conditions
 */
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);
  private redisClient: Redis;

  constructor(@InjectQueue('default') private queue: Queue) {
    // Use the Redis connection from Bull queue
    this.redisClient = (this.queue as any).client;
  }

  /**
   * Acquire a distributed lock with automatic expiration
   * @param key Lock key (e.g., 'strategy:123')
   * @param ttl Time to live in milliseconds (default 30 seconds)
   * @returns Lock token if successful, null if lock is already held
   */
  async acquireLock(key: string, ttl: number = 30000): Promise<string | null> {
    const lockKey = `lock:${key}`;
    const token = `${Date.now()}-${Math.random()}`;

    try {
      // SET key token NX PX ttl (atomic operation)
      const result = await this.redisClient.set(
        lockKey,
        token,
        'PX',
        ttl,
        'NX'
      );

      if (result === 'OK') {
        this.logger.debug(`Lock acquired: ${lockKey} with token ${token}`);
        return token;
      }

      this.logger.debug(`Failed to acquire lock: ${lockKey} - already held`);
      return null;
    } catch (error) {
      this.logger.error(`Error acquiring lock ${lockKey}: ${error}`);
      return null;
    }
  }

  /**
   * Release a distributed lock
   * @param key Lock key
   * @param token Lock token returned by acquireLock
   * @returns true if released, false if lock was not held or token mismatch
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const lockKey = `lock:${key}`;

    // Lua script for atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.redisClient.eval(script, 1, lockKey, token);

      if (result === 1) {
        this.logger.debug(`Lock released: ${lockKey}`);
        return true;
      }

      this.logger.debug(`Failed to release lock: ${lockKey} - token mismatch or not held`);
      return false;
    } catch (error) {
      this.logger.error(`Error releasing lock ${lockKey}: ${error}`);
      return false;
    }
  }

  /**
   * Extend the TTL of a held lock (useful for long operations)
   * @param key Lock key
   * @param token Lock token
   * @param ttl New TTL in milliseconds
   * @returns true if extended, false if lock not held or token mismatch
   */
  async extendLock(key: string, token: string, ttl: number = 30000): Promise<boolean> {
    const lockKey = `lock:${key}`;

    // Lua script for atomic check-and-extend
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    try {
      const result = await this.redisClient.eval(script, 1, lockKey, token, ttl);

      if (result === 1) {
        this.logger.debug(`Lock extended: ${lockKey} for ${ttl}ms`);
        return true;
      }

      this.logger.debug(`Failed to extend lock: ${lockKey} - token mismatch or not held`);
      return false;
    } catch (error) {
      this.logger.error(`Error extending lock ${lockKey}: ${error}`);
      return false;
    }
  }

  /**
   * Wait for a lock to become available and acquire it
   * @param key Lock key
   * @param maxWait Maximum wait time in milliseconds
   * @param ttl Lock TTL once acquired
   * @returns Lock token if acquired within maxWait, null otherwise
   */
  async waitForLock(key: string, maxWait: number = 5000, ttl: number = 30000): Promise<string | null> {
    const startTime = Date.now();
    const retryInterval = 100; // Check every 100ms

    while (Date.now() - startTime < maxWait) {
      const token = await this.acquireLock(key, ttl);
      if (token) {
        return token;
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }

    this.logger.warn(`Timeout waiting for lock: ${key} after ${maxWait}ms`);
    return null;
  }

  /**
   * Execute a function with a distributed lock
   * @param key Lock key
   * @param fn Function to execute
   * @param ttl Lock TTL
   * @returns Result of fn or throws if lock cannot be acquired
   */
  async executeWithLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttl: number = 30000
  ): Promise<T> {
    const token = await this.acquireLock(key, ttl);

    if (!token) {
      throw new Error(`Failed to acquire lock for ${key}`);
    }

    try {
      // Execute the function
      const result = await fn();
      return result;
    } finally {
      // Always release the lock
      await this.releaseLock(key, token);
    }
  }

  /**
   * Check if a lock is currently held
   * @param key Lock key
   * @returns true if lock is held, false otherwise
   */
  async isLocked(key: string): Promise<boolean> {
    const lockKey = `lock:${key}`;
    try {
      const result = await this.redisClient.get(lockKey);
      return result !== null;
    } catch (error) {
      this.logger.error(`Error checking lock ${lockKey}: ${error}`);
      return false;
    }
  }
}