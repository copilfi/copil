#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';
import { SeiProvider } from '../src/providers/SeiProvider';
import { Wallet, Contract, ethers } from 'ethers';
import { SUPPORTED_NETWORKS } from '../src/constants';

// Load environment variables
config({ path: resolve(__dirname, '../../../.env') });

async function debugFactory() {
  console.log('🔍 Factory Contract Debug Test...\n');

  try {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    const factoryAddress = '0xcF7038Cd52C5BE08EEdFa3f042B9842AFaBB99A2';
    const wallet = new Wallet(privateKey);
    const walletAddress = wallet.address;
    
    console.log(`🏭 Factory Address: ${factoryAddress}`);
    console.log(`👤 Owner Address: ${walletAddress}\n`);

    // Initialize provider
    const seiProvider = new SeiProvider(SUPPORTED_NETWORKS.SEI_MAINNET, privateKey);
    const provider = seiProvider.getEvmProvider();

    // Check if factory contract exists
    const factoryCode = await provider.getCode(factoryAddress);
    console.log(`📋 Factory contract exists: ${factoryCode !== '0x'}`);
    console.log(`📊 Factory code length: ${factoryCode.length} bytes`);

    if (factoryCode === '0x') {
      console.log('❌ Factory contract not deployed!');
      return;
    }

    // Test basic contract calls
    const factoryAbi = [
      'function owner() view returns (address)',
      'function entryPoint() view returns (address)', 
      'function accountImplementation() view returns (address)',
      'function accounts(address) view returns (address)',
      'function isSmartAccount(address) view returns (bool)'
    ];
    
    const factoryContract = new Contract(
      factoryAddress,
      factoryAbi,
      provider
    );

    try {
      console.log('🔧 Testing factory contract calls...');
      
      const owner = await factoryContract.owner();
      console.log(`👑 Factory Owner: ${owner}`);
      
      const entryPoint = await factoryContract.entryPoint();
      console.log(`📍 Entry Point: ${entryPoint}`);
      
      const implementation = await factoryContract.accountImplementation();
      console.log(`🔧 Account Implementation: ${implementation}`);
      
      // Check if implementation exists
      const implCode = await provider.getCode(implementation);
      console.log(`📋 Implementation exists: ${implCode !== '0x'}`);
      
      const ourAccount = await factoryContract.accounts(walletAddress);
      console.log(`📱 Our registered account: ${ourAccount}`);
      
    } catch (callError: any) {
      console.log(`⚠️  Contract call error: ${callError.message}`);
    }

    // Test transaction execution without actual call
    console.log('\n🧪 Testing transaction simulation...');
    
    const createAccountAbi = [
      'function createAccount(address owner, bytes32 salt) returns (address)'
    ];
    
    const factoryWithSigner = new Contract(
      factoryAddress,
      createAccountAbi,
      new Wallet(privateKey, provider)
    );

    const salt = ethers.randomBytes(32);
    
    try {
      // Try static call first (simulation)
      const result = await factoryWithSigner.createAccount.staticCall(walletAddress, salt);
      console.log(`🎯 Static call result: ${result}`);
    } catch (staticError: any) {
      console.log(`⚠️  Static call error: ${staticError.message}`);
      console.log(`Error code: ${staticError.code}`);
      
      if (staticError.info) {
        console.log(`RPC Error: ${JSON.stringify(staticError.info.error)}`);
      }
    }

  } catch (error: any) {
    console.error('\n❌ Debug test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  debugFactory()
    .then(() => {
      console.log('\n🎉 Debug test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}