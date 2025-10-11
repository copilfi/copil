import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConfig } from '@lifi/sdk';

@Injectable()
export class LiFiConfigService implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    createConfig({
      integrator: 'copil-xyz',
      apiKey: this.configService.get<string>('LIFI_API_KEY')!,
    });
  }
}
