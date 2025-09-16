import Redis from 'ioredis';
import { logger } from '@/utils/logger';
import env from './env';

class RedisClient {
  private static instance: RedisClient;
  public client: Redis;
  private isCircuitOpen = false;
  private lastFailureTime = 0;
  private failureCount = 0;
  private readonly circuitBreakerThreshold = 5;
  private readonly circuitBreakerTimeout = 30000; // 30 seconds

  private constructor() {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    this.setupEventHandlers();
  }

  static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('🔴 Redis connecting...');
    });

    this.client.on('ready', () => {
      logger.info('🔴 Redis connected successfully');
    });

    this.client.on('error', (error) => {
      logger.error('❌ Redis connection error:', error);
      this.handleFailure();
    });

    this.client.on('close', () => {
      logger.warn('🔴 Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('🔴 Redis reconnecting...');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('❌ Redis connection failed:', error);
      // Don't exit process, let app continue without Redis
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      logger.info('🔴 Redis disconnected');
    } catch (error) {
      logger.error('❌ Redis disconnection failed:', error);
    }
  }

  private handleFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.circuitBreakerThreshold) {
      this.isCircuitOpen = true;
      logger.warn(`🔴 Redis circuit breaker opened after ${this.failureCount} failures`);
    }
  }

  private handleSuccess(): void {
    if (this.isCircuitOpen || this.failureCount > 0) {
      this.failureCount = 0;
      this.isCircuitOpen = false;
      logger.info('🟢 Redis circuit breaker closed - service recovered');
    }
  }

  private shouldAttemptRequest(): boolean {
    if (!this.isCircuitOpen) return true;

    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure > this.circuitBreakerTimeout) {
      logger.info('🔄 Redis circuit breaker half-open - attempting request');
      return true;
    }

    return false;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.shouldAttemptRequest()) {
      return false;
    }

    try {
      const result = await this.client.ping();
      const isHealthy = result === 'PONG';
      if (isHealthy) {
        this.handleSuccess();
      }
      return isHealthy;
    } catch (error) {
      logger.error('❌ Redis health check failed:', error);
      this.handleFailure();
      return false;
    }
  }

  // Cache utilities with circuit breaker
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.shouldAttemptRequest()) {
      logger.debug(`🔴 Redis SET skipped for key ${key} - circuit breaker open`);
      return;
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      this.handleSuccess();
    } catch (error) {
      logger.error(`❌ Redis SET failed for key ${key}:`, error);
      this.handleFailure();
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.shouldAttemptRequest()) {
      logger.debug(`🔴 Redis GET skipped for key ${key} - circuit breaker open`);
      return null;
    }

    try {
      const result = await this.client.get(key);
      this.handleSuccess();
      return result;
    } catch (error) {
      logger.error(`❌ Redis GET failed for key ${key}:`, error);
      this.handleFailure();
      return null;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.shouldAttemptRequest()) {
      logger.debug(`🔴 Redis DEL skipped for key ${key} - circuit breaker open`);
      return;
    }

    try {
      await this.client.del(key);
      this.handleSuccess();
    } catch (error) {
      logger.error(`❌ Redis DEL failed for key ${key}:`, error);
      this.handleFailure();
    }
  }

  async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.set(key, serialized, ttl);
    } catch (error) {
      logger.error(`❌ Redis SET JSON failed for key ${key}:`, error);
    }
  }

  async getJSON<T>(key: string): Promise<T | null> {
    try {
      const value = await this.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`❌ Redis GET JSON failed for key ${key}:`, error);
      return null;
    }
  }
}

export const redis = RedisClient.getInstance();
export default redis;