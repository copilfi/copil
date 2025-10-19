import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { http, createPublicClient, Chain, concat, encodeFunctionData, defineChain } from 'viem';
import { mainnet, base, arbitrum, linea, optimism, polygon, bsc, avalanche } from 'viem/chains';
import { getSenderAddress } from 'permissionless/actions';
import { entryPoint06Address } from 'viem/account-abstraction';
import {
  getSafeSingletonDeployment,
  getProxyFactoryDeployment,
} from '@safe-global/safe-deployments';

const hyperEvm: Chain = defineChain({
  id: 999,
  name: 'HyperEVM',
  network: 'hyperevm',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyper.invalid'] } },
});

const chainMap: Record<string, Chain> = {
  ethereum: mainnet,
  base,
  arbitrum,
  linea,
  optimism,
  polygon,
  bsc,
  avalanche,
  hyperevm: hyperEvm,
};

@Injectable()
export class SmartAccountService {
  constructor(private readonly configService: ConfigService) {}

  async getSmartAccountAddress(
    owner: `0x${string}`,
    chainName: string,
  ): Promise<`0x${string}`> {
    const chain = chainMap[chainName.toLowerCase()];
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainName}`);
    }

    const publicClient = createPublicClient({
      transport: http(this.getRpcUrl(chainName)),
    });

    const safeSingleton = getSafeSingletonDeployment({
      version: '1.4.1',
      network: chain.id.toString(),
    });
    const safeProxyFactory = getProxyFactoryDeployment({
      version: '1.4.1',
      network: chain.id.toString(),
    });

    if (!safeSingleton || !safeProxyFactory) {
      throw new Error(`Safe deployments not found for chain ${chainName}`);
    }

    const setupData = encodeFunctionData({
      abi: safeSingleton.abi,
      functionName: 'setup',
      args: [
        [owner],
        1n, // Use BigInt
        '0x0000000000000000000000000000000000000000',
        '0x',
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        0n, // Use BigInt
        '0x0000000000000000000000000000000000000000',
      ],
    });

    const factoryData = encodeFunctionData({
        abi: safeProxyFactory.abi,
        functionName: 'createProxyWithNonce',
        args: [safeSingleton.defaultAddress as `0x${string}`, setupData, 0n] // Use BigInt for salt
    });

    const initCode = concat([
        safeProxyFactory.defaultAddress as `0x${string}`,
        factoryData
    ]);

    const senderAddress = await getSenderAddress(publicClient, {
      initCode,
      entryPointAddress: entryPoint06Address,
    });

    return senderAddress;
  }

  private getRpcUrl(chain: string): string {
    const key = `RPC_URL_${chain.toUpperCase()}`;
    const url =
      this.configService.get<string>(key) ??
      this.configService.get<string>('RPC_URL');
    if (!url) {
      throw new Error(`RPC URL for chain ${chain} not configured.`);
    }
    return url;
  }
}
