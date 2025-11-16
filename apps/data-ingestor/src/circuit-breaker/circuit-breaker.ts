import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CircuitBreakerStatus {
  tripped: boolean;
  reason?: string;
  lastFailureTime?: Date;
  failureCount: number;
  manualOverride: boolean;
  failureThreshold: number;
}

@Injectable()
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private failureCount = 0;
  private lastFailureTime?: Date;
  private tripped = false;
  private reason = '';
  private manualOverride = false;
  private readonly failureThreshold: number;

  constructor(private readonly configService: ConfigService) {
    this.failureThreshold = this.configService.get<number>(
      'CIRCUIT_BREAKER_THRESHOLD',
      5,
    );
  }

  async recordFailure(): Promise<void> {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= this.failureThreshold) {
      this.tripped = true;
      this.reason = 'Failure threshold exceeded';
      this.logger.warn(`Circuit breaker tripped: ${this.reason}`);
    }
  }

  async reset(): Promise<boolean> {
    this.failureCount = 0;
    this.tripped = false;
    this.reason = '';
    this.lastFailureTime = undefined;
    this.manualOverride = false;
    this.logger.log('Circuit breaker reset');
    return true;
  }

  getStatus(): CircuitBreakerStatus {
    return {
      tripped: this.tripped,
      reason: this.tripped ? this.reason : undefined,
      lastFailureTime: this.lastFailureTime,
      failureCount: this.failureCount,
      manualOverride: this.manualOverride,
      failureThreshold: this.failureThreshold,
    };
  }

  async manuallyTrip(reason: string, _duration?: number): Promise<boolean> {
    this.tripped = true;
    this.reason = reason;
    this.lastFailureTime = new Date();
    this.logger.warn(`Circuit breaker manually tripped: ${reason}`);
    return true;
  }
}
