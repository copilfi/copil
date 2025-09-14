#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';
import { SeiProvider } from '../src/providers/SeiProvider';
import { Wallet, Contract, ethers } from 'ethers';
import { SUPPORTED_NETWORKS } from '../src/constants';

// Load environment variables
config({ path: resolve(__dirname, '../../../.env') });

async function createSmartAccount() {
  console.log('🚀 Creating Smart Account on Sei Mainnet...\n');

  try {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    const factoryAddress = '0xcF7038Cd52C5BE08EEdFa3f042B9842AFaBB99A2';
    const wallet = new Wallet(privateKey);
    const walletAddress = wallet.address;
    
    console.log(`🏭 Factory Address: ${factoryAddress}`);
    console.log(`👤 Owner Address: ${walletAddress}`);

    // Initialize provider  
    const seiProvider = new SeiProvider(SUPPORTED_NETWORKS.SEI_MAINNET, privateKey);
    const provider = seiProvider.getEvmProvider();

    const factoryAbi = [
      'function createAccount(address owner, bytes32 salt) returns (address)',
      'function getAccount(address owner) view returns (address)',
      'function accounts(address) view returns (address)',
      'function isSmartAccount(address) view returns (bool)'
    ];
    
    const factoryContract = new Contract(
      factoryAddress,
      factoryAbi,
      new Wallet(privateKey, provider)
    );

    // Check if account already exists
    const existingAccount = await factoryContract.getAccount(walletAddress);
    
    if (existingAccount !== ethers.ZeroAddress) {
      console.log(`✅ Smart Account already exists: ${existingAccount}`);
      return existingAccount;
    }

    console.log('🔄 No existing account found, creating new one...');

    // Generate salt
    const salt = ethers.randomBytes(32);
    console.log(`🧂 Salt: ${ethers.hexlify(salt)}`);

    // Check balance for gas
    const balance = await provider.getBalance(walletAddress);
    console.log(`💰 Current balance: ${ethers.formatEther(balance)} SEI`);

    if (BigInt(balance) < ethers.parseEther('0.005')) {
      throw new Error('Insufficient balance. Need at least 0.005 SEI for deployment');
    }

    // Get gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt('1100000000');
    console.log(`⛽ Gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);

    // Execute deployment with manual gas settings
    console.log('\n🚀 Deploying Smart Account...');
    
    const tx = await factoryContract.createAccount(walletAddress, salt, {
      gasLimit: 2000000, // Manual gas limit
      gasPrice: gasPrice
    });
    
    console.log(`📝 Transaction Hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block: ${receipt?.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt?.gasUsed.toString()}`);
    console.log(`💸 Total cost: ${ethers.formatEther(receipt?.gasUsed * gasPrice)} SEI`);

    // Get the created account address
    const createdAccount = await factoryContract.getAccount(walletAddress);
    console.log(`🎉 Smart Account created: ${createdAccount}`);

    // Verify deployment
    if (createdAccount !== ethers.ZeroAddress) {
      const code = await provider.getCode(createdAccount);
      const isDeployed = code !== '0x';
      console.log(`✅ Smart Account deployed: ${isDeployed}`);
      console.log(`📊 Contract code length: ${code.length} bytes`);

      // Check if factory recognizes it
      const isRecognized = await factoryContract.isSmartAccount(createdAccount);
      console.log(`🔍 Factory recognizes account: ${isRecognized}`);

      // Check account balance
      const accountBalance = await provider.getBalance(createdAccount);
      console.log(`💰 Smart Account balance: ${ethers.formatEther(accountBalance)} SEI`);

      return createdAccount;
    }

    throw new Error('Failed to create Smart Account');

  } catch (error: any) {
    console.error('\n❌ Smart Account creation failed:', error.message);
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    if (error.reason) {
      console.error(`Reason: ${error.reason}`);
    }
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  createSmartAccount()
    .then((address) => {
      console.log('\n🎊 Smart Account creation completed!');
      console.log(`📍 Address: ${address}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}