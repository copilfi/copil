import { ethers } from 'ethers';
import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * Generate a random bytes32 value for salt
 */
export function generateRandomBytes32(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

/**
 * Generate deterministic salt from string
 */
export function generateSaltFromString(input: string): string {
  return keccak256(toUtf8Bytes(input));
}

/**
 * Compute Smart Account address using CREATE2
 */
export function computeAccountAddress(
  factoryAddress: string,
  owner: string,
  salt: string,
  implementationAddress: string,
  initData: string = '0x'
): string {
  // This is a simplified version - actual implementation would use the factory's getAddress method
  const bytecode = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implementationAddress.slice(2)}5af43d82803e903d91602b57fd5bf3`;
  const bytecodeHash = keccak256(bytecode + initData.slice(2));
  
  const create2Hash = keccak256(
    ethers.concat([
      '0xff',
      factoryAddress,
      salt,
      bytecodeHash
    ])
  );
  
  return ethers.getAddress('0x' + create2Hash.slice(-40));
}

/**
 * Validate Ethereum address
 */
export function isValidAddress(address: string): boolean {
  try {
    ethers.getAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert address to checksum format
 */
export function toChecksumAddress(address: string): string {
  return ethers.getAddress(address);
}

/**
 * Check if address is zero address
 */
export function isZeroAddress(address: string): boolean {
  return address === ethers.ZeroAddress;
}

/**
 * Generate function selector from signature
 */
export function getFunctionSelector(signature: string): string {
  return ethers.id(signature).slice(0, 10);
}

/**
 * Encode function data
 */
export function encodeFunctionData(
  functionSignature: string,
  params: any[]
): string {
  const iface = new ethers.Interface([`function ${functionSignature}`]);
  const functionName = functionSignature.split('(')[0];
  return iface.encodeFunctionData(functionName, params);
}

/**
 * Decode function data
 */
export function decodeFunctionData(
  functionSignature: string,
  data: string
): any[] {
  const iface = new ethers.Interface([`function ${functionSignature}`]);
  const functionName = functionSignature.split('(')[0];
  return iface.decodeFunctionData(functionName, data);
}

/**
 * Convert Sei bech32 address to EVM hex address (if needed)
 */
export function seiToEvmAddress(seiAddress: string): string {
  // Sei uses standard Ethereum addresses, so this might not be needed
  // But keeping it for potential Cosmos<->EVM address conversion
  if (seiAddress.startsWith('0x')) {
    return seiAddress;
  }
  
  // This would need proper bech32 decoding implementation
  throw new Error('Bech32 to EVM address conversion not implemented');
}

/**
 * Convert EVM hex address to Sei bech32 address (if needed)
 */
export function evmToSeiAddress(evmAddress: string): string {
  // Sei uses standard Ethereum addresses, so this might not be needed
  if (!evmAddress.startsWith('0x')) {
    return evmAddress;
  }
  
  // This would need proper bech32 encoding implementation
  throw new Error('EVM to bech32 address conversion not implemented');
}

/**
 * Extract address from transaction data
 */
export function extractAddressFromCalldata(calldata: string, position: number = 0): string {
  if (calldata.length < 10 + (position + 1) * 64) {
    throw new Error('Calldata too short');
  }
  
  const start = 10 + position * 64 + 24; // Skip function selector + padding
  const addressHex = '0x' + calldata.slice(start, start + 40);
  
  return ethers.getAddress(addressHex);
}

/**
 * Generate CREATE2 address for any contract
 */
export function computeCreate2Address(
  factoryAddress: string,
  salt: string,
  bytecodeHash: string
): string {
  const create2Hash = keccak256(
    ethers.concat([
      '0xff',
      factoryAddress,
      salt,
      bytecodeHash
    ])
  );
  
  return ethers.getAddress('0x' + create2Hash.slice(-40));
}

/**
 * Batch validate addresses
 */
export function validateAddresses(addresses: string[]): boolean[] {
  return addresses.map(addr => isValidAddress(addr));
}

/**
 * Get address from private key
 */
export function getAddressFromPrivateKey(privateKey: string): string {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.address;
}

/**
 * Generate random private key
 */
export function generateRandomPrivateKey(): string {
  const wallet = ethers.Wallet.createRandom();
  return wallet.privateKey;
}
