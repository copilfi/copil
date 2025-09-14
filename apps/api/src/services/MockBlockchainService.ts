import { logger } from '@/utils/logger';
import redis from '@/config/redis';
import env from '@/config/env';

class MockBlockchainService {
  constructor() {
    logger.info('🔗 Mock Blockchain Service initialized (contracts not deployed yet)');
  }

  async getSmartAccountClient(userAddress: string, privateKey?: string) {
    logger.info(`Getting mock Smart Account client for ${userAddress}`);
    return {
      deployAccount: async () => `0x${Math.random().toString(16).substr(2, 40)}`,
      getAccountAddress: async () => `0x${Math.random().toString(16).substr(2, 40)}`,
      executeTransaction: async () => `0x${Math.random().toString(16).substr(2, 64)}`,
      executeBatch: async () => `0x${Math.random().toString(16).substr(2, 64)}`,
      createSessionKey: async () => `0x${Math.random().toString(16).substr(2, 64)}`,
      revokeSessionKey: async () => `0x${Math.random().toString(16).substr(2, 64)}`,
      getAccountInfo: async () => ({
        address: `0x${Math.random().toString(16).substr(2, 40)}`,
        owner: userAddress,
        nonce: '0',
        balance: '1.0',
        isDeployed: false
      })
    };
  }

  async deploySmartAccount(userAddress: string, privateKey?: string): Promise<string> {
    logger.info(`Mock deploying Smart Account for ${userAddress}`);
    const mockAddress = `0x${Math.random().toString(16).substr(2, 40)}`;
    
    await redis.setJSON(`deployed_account_${userAddress}`, {
      address: mockAddress,
      deployedAt: new Date().toISOString()
    }, 3600);
    
    return mockAddress;
  }

  async getSmartAccountAddress(userAddress: string): Promise<string> {
    const cached = await redis.getJSON<{ address: string; deployedAt: string }>(
      `deployed_account_${userAddress}`
    );
    
    if (cached) {
      return cached.address;
    }

    return `0x${Math.random().toString(16).substr(2, 40)}`;
  }

  async executeTransaction(
    userAddress: string,
    to: string,
    value: string,
    data: string,
    privateKey?: string
  ): Promise<string> {
    logger.info(`Mock executing transaction for ${userAddress}`);
    return `0x${Math.random().toString(16).substr(2, 64)}`;
  }

  async executeBatchTransactions(
    userAddress: string,
    transactions: Array<{ to: string; value: string; data: string }>,
    privateKey?: string
  ): Promise<string> {
    logger.info(`Mock executing batch transaction for ${userAddress}`);
    return `0x${Math.random().toString(16).substr(2, 64)}`;
  }

  async createSessionKey(
    userAddress: string,
    sessionKeyConfig: any,
    privateKey?: string
  ): Promise<string> {
    logger.info(`Mock creating session key for ${userAddress}`);
    return `0x${Math.random().toString(16).substr(2, 64)}`;
  }

  async revokeSessionKey(
    userAddress: string,
    sessionKey: string,
    privateKey?: string
  ): Promise<string> {
    logger.info(`Mock revoking session key for ${userAddress}`);
    return `0x${Math.random().toString(16).substr(2, 64)}`;
  }

  async getNetworkInfo() {
    return {
      chainId: env.NODE_ENV === 'production' ? 1329 : 713715,
      name: env.NODE_ENV === 'production' ? 'sei-mainnet' : 'sei-testnet',
      blockNumber: Math.floor(Math.random() * 1000000),
      gasPrice: '1000000000',
      isTestnet: env.NODE_ENV !== 'production'
    };
  }

  async getBalance(address: string): Promise<string> {
    return (Math.random() * 10).toFixed(4);
  }

  async healthCheck(): Promise<boolean> {
    return true; // Mock always healthy
  }
}

export const blockchainService = new MockBlockchainService();
export default blockchainService;