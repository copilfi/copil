import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ArchivalService {
  private readonly logger = new Logger(ArchivalService.name);

  constructor(private readonly configService: ConfigService) {}

  async archiveEvents(eventIds: string[]): Promise<void> {
    this.logger.warn(`ArchivalService.archiveEvents - Not implemented for ${eventIds.length} events`);
  }

  async cleanupOldEvents(retentionDays: number): Promise<number> {
    this.logger.warn(`ArchivalService.cleanupOldEvents - Not implemented for retention: ${retentionDays} days`);
    return 0;
  }
}
