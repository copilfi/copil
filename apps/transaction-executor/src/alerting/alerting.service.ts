import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Monitor, MonitorAlert } from '@copil/database';

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendAlert(alert: MonitorAlert): Promise<void> {
    this.logger.warn(`Alert sent: ${alert.message} (${alert.severity})`);
  }

  async escalateAlert(alert: MonitorAlert, level: number): Promise<void> {
    this.logger.warn(`Alert escalated to level ${level}: ${alert.message}`);
  }
}
