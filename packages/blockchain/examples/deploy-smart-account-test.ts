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

async function deploySmartAccountTest() {
  console.log('🏗️  Starting Smart Account Deployment Test...\n');

  try {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    const wallet = new Wallet(privateKey);
    const walletAddress = wallet.address;
    
    console.log(`👤 Owner Address: ${walletAddress}`);
    console.log(`🏭 Factory Address: ${DEPLOYED_CONTRACTS.ACCOUNT_FACTORY}\n`);

    // Initialize provider
    const seiProvider = new SeiProvider(SUPPORTED_NETWORKS.SEI_MAINNET, privateKey);
    const provider = seiProvider.getEvmProvider();

    // Test Factory Contract direkt olarak
    console.log('🔧 Testing Factory Contract interaction...');
    
    const factoryAbi = [
      'function createAccount(address owner, bytes32 salt) returns (address)',
      'function getAccount(address owner) view returns (address)',
      'function getAddress(address owner, bytes32 salt) view returns (address)',
      'function isAccount(address account) view returns (bool)',
      'function accounts(address owner) view returns (address)',
      'function isSmartAccount(address account) view returns (bool)'
    ];
    
    const factoryContract = new Contract(
      DEPLOYED_CONTRACTS.ACCOUNT_FACTORY,
      factoryAbi,
      new Wallet(privateKey, provider)
    );

    // Check current state
    const currentAccount = await factoryContract.getAccount(walletAddress);
    console.log(`📋 Current registered account: ${currentAccount}`);

    if (currentAccount === ethers.ZeroAddress) {
      console.log('🚀 No account exists, creating new Smart Account...');

      // Generate salt
      const salt = ethers.randomBytes(32);
      console.log(`🧂 Using salt: ${ethers.hexlify(salt)}`);

      // Predict address
      const predictedAddress = await factoryContract.getAddress(walletAddress, salt);
      console.log(`🔮 Predicted address: ${predictedAddress}`);

      // Check current balance for gas
      const balance = await provider.getBalance(walletAddress);
      console.log(`💰 Current balance: ${ethers.formatEther(balance)} SEI`);

      if (BigInt(balance) < ethers.parseEther('0.01')) {
        throw new Error('Insufficient balance for deployment. Need at least 0.01 SEI');
      }

      // Estimate gas
      const gasEstimate = await factoryContract.createAccount.estimateGas(walletAddress, salt);
      console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);

      // Get gas price
      const feeData = await provider.getFeeData();
      console.log(`💸 Gas price: ${ethers.formatUnits(feeData.gasPrice || '0', 'gwei')} gwei`);

      // Execute deployment
      console.log('\n🚀 Deploying Smart Account...');
      const tx = await factoryContract.createAccount(walletAddress, salt);
      
      console.log(`📝 Transaction Hash: ${tx.hash}`);
      console.log('⏳ Waiting for confirmation...');

      const receipt = await tx.wait();
      console.log(`✅ Transaction confirmed in block: ${receipt?.blockNumber}`);
      console.log(`⛽ Gas used: ${receipt?.gasUsed.toString()}`);

      // Check if account was created
      const newAccount = await factoryContract.getAccount(walletAddress);
      console.log(`🎉 New Smart Account address: ${newAccount}`);

      if (newAccount !== ethers.ZeroAddress) {
        // Verify deployment
        const code = await provider.getCode(newAccount);
        const isDeployed = code !== '0x';
        console.log(`🔍 Smart Account deployed: ${isDeployed}`);
        
        if (isDeployed) {
          console.log(`📊 Contract code length: ${code.length} bytes`);
          
          // Test Smart Account functionality
          console.log('\n🧠 Testing Smart Account functionality...');
          
          const smartAccountConfig = {
            owner: walletAddress,
            entryPoint: DEPLOYED_CONTRACTS.ENTRY_POINT,
            factory: DEPLOYED_CONTRACTS.ACCOUNT_FACTORY,
            salt: ethers.hexlify(salt)
          };

          const smartAccountClient = new SmartAccountClient(
            seiProvider,
            smartAccountConfig,
            privateKey
          );

          const accountInfo = await smartAccountClient.getAccountInfo();
          console.log(`👤 Smart Account Owner: ${accountInfo.owner}`);
          console.log(`💰 Smart Account Balance: ${accountInfo.balance} SEI`);
          console.log(`#️⃣  Smart Account Nonce: ${accountInfo.nonce}`);
        }
      }

    } else {
      console.log(`✅ Smart Account already exists: ${currentAccount}`);
    }

  } catch (error: any) {
    console.error('\n❌ Smart Account deployment test failed:', error.message);
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    if (error.reason) {
      console.error(`Reason: ${error.reason}`);
    }
    logger.error('Smart Account deployment test failed', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  deploySmartAccountTest()
    .then(() => {
      console.log('\n🎉 Smart Account deployment test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}