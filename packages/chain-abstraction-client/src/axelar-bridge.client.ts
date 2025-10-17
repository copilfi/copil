import { encodeFunctionData } from 'viem';
import type { TransactionIntent, GetQuoteResponse, Quote } from './types';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const AXELAR_GATEWAY_ABI = [
  {
    type: 'function',
    name: 'sendToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'destinationChain', type: 'string' },
      { name: 'destinationAddress', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

function env(name: string): string | undefined {
  return process.env[name];
}

function getGatewayAddress(chain: string): `0x${string}` | undefined {
  const key = `AXELAR_GATEWAY_ADDRESS_${chain.toUpperCase()}`;
  const addr = env(key);
  if (!addr) return undefined;
  return addr as `0x${string}`;
}

export class AxelarBridgeClient {
  async getSeiBridgeQuote(intent: TransactionIntent): Promise<GetQuoteResponse> {
    // Only support EVM -> Sei initial path
    if (intent.type !== 'bridge') {
      throw new Error('AxelarBridgeClient only supports bridge intents.');
    }
    if (intent.toChain.toLowerCase() !== 'sei') {
      throw new Error('Only EVM -> Sei bridge is supported in the initial rollout.');
    }

    if (process.env.SEI_BRIDGE_ENABLED !== 'true') {
      throw new Error('Sei bridge disabled. Set SEI_BRIDGE_ENABLED=true and configure AXELAR_* envs.');
    }

    const fromChain = intent.fromChain.toLowerCase();
    const gateway = getGatewayAddress(fromChain);
    if (!gateway) {
      throw new Error(`Axelar gateway not configured for chain ${fromChain}. Set AXELAR_GATEWAY_ADDRESS_${fromChain.toUpperCase()}.`);
    }

    const destinationChain = env('AXELAR_SEI_CHAIN_NAME') ?? 'sei';
    const symbol = env('AXELAR_TOKEN_SYMBOL_USDC') ?? 'aUSDC';

    // Build approval tx (approve gateway to spend fromToken)
    const approvalData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [gateway, BigInt(intent.fromAmount)],
    });

    const approvalTransactionRequest = {
      to: intent.fromToken as `0x${string}`,
      data: approvalData,
      value: '0',
    };

    // Build sendToken tx
    const sendData = encodeFunctionData({
      abi: AXELAR_GATEWAY_ABI,
      functionName: 'sendToken',
      args: [destinationChain, intent.userAddress, symbol, BigInt(intent.fromAmount)],
    });

    const transactionRequest = {
      to: gateway,
      data: sendData,
      value: '0',
    };

    const quote: Quote = {
      id: `axelar-${Date.now()}`,
      fromAmount: intent.fromAmount,
      toAmount: intent.fromAmount, // Placeholder: exact toAmount on destination chain will differ; refine once fee calc is added
      transactionRequest,
      approvalTransactionRequest,
    } as any;

    return { quote };
  }
}
