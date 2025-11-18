import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditEvent } from '@copil/database';
import * as crypto from 'crypto';

@Injectable()
export class CryptographicHasher {
  private readonly logger = new Logger(CryptographicHasher.name);

  constructor(private readonly configService: ConfigService) {}

  async hashEvent(event: AuditEvent): Promise<string> {
    const eventString = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp,
      eventType: event.eventType,
      userId: event.userId,
      requestId: event.requestId,
      action: event.action,
      resource: event.resource,
      outcome: event.outcome,
    });

    return crypto.createHash('sha256').update(eventString).digest('hex');
  }

  async hash(data: Buffer | string): Promise<string> {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
