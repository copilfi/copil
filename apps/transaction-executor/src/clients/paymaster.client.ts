import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { http, Chain, Transport } from 'viem';

@Injectable()
export class PaymasterClient {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns a viem HTTP transport pointing at Pimlico's paymaster for the given chain.
   * Pass this to permissionless `createSmartAccountClient` as `paymasterTransport`.
   * When disabled or API key missing, callers should avoid using this transport.
   */
  getTransport(chain: Chain): Transport {
    const enabled = this.configService.get<string>('PAYMASTER_ENABLED') === 'true';
    if (!enabled) {
      throw new Error('Paymaster is disabled by configuration.');
    }
    const apiKey =
      this.configService.get<string>('PIMLICO_PAYMASTER_API_KEY') ||
      this.configService.get<string>('PIMLICO_API_KEY');
    if (!apiKey) {
      throw new Error('PIMLICO_PAYMASTER_API_KEY (or PIMLICO_API_KEY) is not configured.');
    }
    // Pimlico v2 paymaster endpoint - API key moved to header for security
    const url = `https://api.pimlico.io/v2/${chain.name.toLowerCase()}/rpc`;
    return http(url, {
      fetchOptions: {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    });
  }
}
