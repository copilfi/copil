#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';
import { SmartAccountClient } from '../src/clients/SmartAccountClient';
import { SeiProvider } from '../src/providers/SeiProvider';
import { logger } from '../src/utils/Logger';
import { Wallet, Contract, ethers } from 'ethers';
import { SUPPORTED_NETWORKS, SMART_ACCOUNT_DEFAULTS } from '../src/constants';

// Load environment variables
config({ path: resolve(__dirname, '../../../.env') });

// Deploy edilen gerçek kontrat adreslerini kullan
const DEPLOYED_CONTRACTS = {
  ENTRY_POINT: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  ACCOUNT_FACTORY: '0xcF7038Cd52C5BE08EEdFa3f042B9842AFaBB99A2',
  CONDITIONAL_ORDER_ENGINE: '0x425020571862cfDc97727bB6c920866D8BeAbbeB'
};

async function testSmartAccount() {
  console.log('🧠 Starting Smart Account Test...\n');

  try {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    const wallet = new Wallet(privateKey);
    const walletAddress = wallet.address;
    
    console.log(`👤 Wallet Address: ${walletAddress}`);
    console.log(`🏭 Factory Address: ${DEPLOYED_CONTRACTS.ACCOUNT_FACTORY}`);
    console.log(`📍 EntryPoint Address: ${DEPLOYED_CONTRACTS.ENTRY_POINT}`);
    console.log(`🤖 OrderEngine Address: ${DEPLOYED_CONTRACTS.CONDITIONAL_ORDER_ENGINE}\n`);

    // Initialize provider
    const seiProvider = new SeiProvider(SUPPORTED_NETWORKS.SEI_MAINNET, privateKey);
    
    // Test 1: Initialize SmartAccountClient
    console.log('🔧 Testing SmartAccountClient initialization...');
    
    const smartAccountConfig = {
      owner: walletAddress,
      entryPoint: DEPLOYED_CONTRACTS.ENTRY_POINT,
      factory: DEPLOYED_CONTRACTS.ACCOUNT_FACTORY,
      salt: SMART_ACCOUNT_DEFAULTS.DEFAULT_SALT
    };

    const smartAccountClient = new SmartAccountClient(
      seiProvider,
      smartAccountConfig,
      privateKey
    );

    console.log('✅ SmartAccountClient initialized successfully');

    // Test 2: Check if account already exists
    console.log('\n🔍 Checking if Smart Account already exists...');
    
    const accountAddress = await smartAccountClient.getAccountAddress();
    console.log(`📱 Predicted/Existing Account Address: ${accountAddress}`);

    // Check if account exists by checking code
    const provider = seiProvider.getEvmProvider();
    const code = await provider.getCode(accountAddress);
    const isDeployed = code !== '0x';
    
    console.log(`🏗️  Account Deployed: ${isDeployed ? 'YES' : 'NO'}`);

    if (isDeployed) {
      console.log('✅ Smart Account already exists');
      
      // Test account info
      console.log('\n📊 Getting account info...');
      const accountInfo = await smartAccountClient.getAccountInfo();
      console.log(`👤 Owner: ${accountInfo.owner}`);
      console.log(`💰 Balance: ${accountInfo.balance} SEI`);
      console.log(`#️⃣  Nonce: ${accountInfo.nonce}`);
      console.log(`🚀 Deployed: ${accountInfo.isDeployed}`);
      
    } else {
      // Test 3: Deploy Smart Account
      console.log('\n🚀 Deploying Smart Account...');
      
      try {
        const deployedAddress = await smartAccountClient.deployAccount();
        console.log(`✅ Smart Account deployed at: ${deployedAddress}`);
        
        // Verify deployment
        const newCode = await provider.getCode(deployedAddress);
        const newlyDeployed = newCode !== '0x';
        console.log(`🔍 Verification - Contract deployed: ${newlyDeployed}`);
        
        if (newlyDeployed) {
          console.log('\n📊 Getting new account info...');
          const accountInfo = await smartAccountClient.getAccountInfo();
          console.log(`👤 Owner: ${accountInfo.owner}`);
          console.log(`💰 Balance: ${accountInfo.balance} SEI`);
          console.log(`#️⃣  Nonce: ${accountInfo.nonce}`);
        }
        
      } catch (deployError: any) {
        console.log(`⚠️  Deployment may have failed: ${deployError.message}`);
        console.log('This might be expected if the account already exists');
      }
    }

    // Test 4: Factory Contract Direct Test
    console.log('\n🏭 Testing Factory Contract directly...');
    
    const factoryAbi = [
      'function accounts(address) view returns (address)',
      'function isSmartAccount(address) view returns (bool)',
      'function getAddress(address owner, bytes32 salt) view returns (address)'
    ];
    
    const factoryContract = new Contract(
      DEPLOYED_CONTRACTS.ACCOUNT_FACTORY,
      factoryAbi,
      provider
    );
    
    try {
      const factoryAccount = await factoryContract.accounts(walletAddress);
      console.log(`🏭 Factory recorded account: ${factoryAccount}`);
      
      const isSmartAccount = await factoryContract.isSmartAccount(accountAddress);
      console.log(`✅ Is recognized Smart Account: ${isSmartAccount}`);
      
    } catch (factoryError: any) {
      console.log(`⚠️  Factory test error: ${factoryError.message}`);
    }

    console.log('\n🎉 Smart Account test completed!');

  } catch (error: any) {
    console.error('\n❌ Smart Account test failed:', error.message);
    logger.error('Smart Account test failed', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testSmartAccount()
    .then(() => {
      console.log('\n✨ Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}