import { AxelarBridgeClient } from './axelar-bridge.client';

describe('AxelarBridgeClient', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.SEI_BRIDGE_ENABLED = 'true';
    process.env.AXELAR_GATEWAY_ADDRESS_ETHEREUM = '0x1111111111111111111111111111111111111111';
    process.env.AXELAR_SEI_CHAIN_NAME = 'sei';
    process.env.AXELAR_TOKEN_SYMBOL_USDC = 'aUSDC';
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('builds approval and sendToken tx requests', async () => {
    const client = new AxelarBridgeClient();
    const intent = {
      type: 'bridge' as const,
      fromChain: 'ethereum',
      toChain: 'sei',
      fromToken: '0x2222222222222222222222222222222222222222',
      toToken: 'USDC',
      fromAmount: '1000000',
      userAddress: '0x3333333333333333333333333333333333333333',
    };

    const { quote } = await client.getSeiBridgeQuote(intent);
    expect(quote.transactionRequest).toBeDefined();
    expect(quote.approvalTransactionRequest).toBeDefined();
    expect(quote.transactionRequest.to).toBe('0x1111111111111111111111111111111111111111');
  });
});

