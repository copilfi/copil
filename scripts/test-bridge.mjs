// Quick smoke script to build Axelar approval + sendToken calls using current env.
// Usage: node scripts/test-bridge.mjs
import { encodeFunctionData } from 'viem';

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [ { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' } ], outputs: [ { name: '', type: 'bool' } ] },
];

const AXELAR_GATEWAY_ABI = [
  { type: 'function', name: 'sendToken', stateMutability: 'nonpayable', inputs: [ { name: 'destinationChain', type: 'string' }, { name: 'destinationAddress', type: 'string' }, { name: 'symbol', type: 'string' }, { name: 'amount', type: 'uint256' } ], outputs: [] },
];

const fromChain = process.env.TEST_FROM_CHAIN || 'ethereum';
const gateway = process.env[`AXELAR_GATEWAY_ADDRESS_${fromChain.toUpperCase()}`];
const destinationChain = process.env.AXELAR_SEI_CHAIN_NAME || 'sei';
const symbol = process.env.AXELAR_TOKEN_SYMBOL_USDC || 'aUSDC';

if (!gateway) {
  console.error(`Missing gateway address for ${fromChain}. Set AXELAR_GATEWAY_ADDRESS_${fromChain.toUpperCase()}.`);
  process.exit(1);
}

const fromToken = process.env.TEST_FROM_TOKEN || '0x2222222222222222222222222222222222222222';
const userAddress = process.env.TEST_USER_ADDRESS || '0x3333333333333333333333333333333333333333';
const fromAmount = BigInt(process.env.TEST_FROM_AMOUNT || '1000000');

const approvalData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [ gateway, fromAmount ] });
const sendData = encodeFunctionData({ abi: AXELAR_GATEWAY_ABI, functionName: 'sendToken', args: [ destinationChain, userAddress, symbol, fromAmount ] });

const approvalTx = { to: fromToken, data: approvalData, value: '0' };
const sendTx = { to: gateway, data: sendData, value: '0' };

console.log('Approval transactionRequest:', JSON.stringify(approvalTx));
console.log('SendToken transactionRequest:', JSON.stringify(sendTx));
