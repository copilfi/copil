import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { http, Chain, Transport } from 'viem';

@Injectable()
export class BundlerClient {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns a viem HTTP transport pointing at Pimlico's bundler for the given chain.
   * Pass this to permissionless `createSmartAccountClient` as `bundlerTransport`.
   */
  getTransport(chain: Chain): Transport {
    const apiKey = this.configService.get<string>('PIMLICO_API_KEY');
    if (!apiKey) {
      throw new Error('PIMLICO_API_KEY is not configured.');
    }
    const bundlerUrl = `https://api.pimlico.io/v1/${chain.name.toLowerCase()}/rpc?apikey=${apiKey}`;
    return http(bundlerUrl);
  }
}
