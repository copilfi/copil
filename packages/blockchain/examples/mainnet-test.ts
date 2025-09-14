#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';
import { SeiProvider } from '../src/providers/SeiProvider';
import { SeiClient } from '../src/clients/SeiClient';
import { logger } from '../src/utils/Logger';
import { Wallet } from 'ethers';
import { SUPPORTED_NETWORKS } from '../src/constants';

// Load environment variables from root .env
config({ path: resolve(__dirname, '../../../.env') });

async function testMainnet() {
  console.log('🚀 Starting Sei Mainnet Test...\n');

  try {
    // Environment validation
    const privateKey = process.env.PRIVATE_KEY;
    const rpcUrl = process.env.SEI_RPC_URL;

    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    if (!rpcUrl) {
      throw new Error('SEI_RPC_URL not found in environment');
    }

    // Create wallet from private key
    const wallet = new Wallet(privateKey);
    const walletAddress = wallet.address;
    
    console.log(`📱 Wallet Address: ${walletAddress}`);
    console.log(`🌐 RPC URL: ${rpcUrl}`);
    console.log(`⛓️  Chain ID: ${SUPPORTED_NETWORKS.SEI_MAINNET.chainId}\n`);

    // Initialize Sei Client
    const seiClient = new SeiClient({
      network: SUPPORTED_NETWORKS.SEI_MAINNET,
      privateKey: privateKey
    });

    console.log('✅ SeiClient initialized successfully');

    // Test 1: Get wallet balance
    console.log('\n📊 Testing Balance Query...');
    const balance = await seiClient.getBalance(walletAddress);
    console.log(`💰 SEI Balance: ${balance} SEI`);

    // Test 2: Get current block number
    console.log('\n🧱 Testing Block Info...');
    const blockNumber = await seiClient.getBlockNumber();
    console.log(`🔢 Current Block: ${blockNumber}`);

    // Test 3: Get gas price
    console.log('\n⛽ Testing Gas Price...');
    const gasPrice = await seiClient.getGasPrice();
    console.log(`💨 Gas Price: ${gasPrice} wei`);

    // Test 4: Provider connectivity test
    console.log('\n🔗 Testing Provider Connectivity...');
    const provider = seiClient.getProvider();
    const evmProvider = provider.getEvmProvider();
    
    const network = await evmProvider.getNetwork();
    console.log(`🌐 Connected Network: ${network.name} (Chain ID: ${network.chainId})`);

    // Test 5: Get account nonce
    console.log('\n🔄 Testing Account Nonce...');
    const nonce = await evmProvider.getTransactionCount(walletAddress);
    console.log(`#️⃣  Account Nonce: ${nonce}`);

    // Test 6: Fee data
    console.log('\n💸 Testing Fee Data...');
    const feeData = await evmProvider.getFeeData();
    console.log(`⛽ Gas Price: ${feeData.gasPrice} wei`);
    console.log(`🏎️  Max Fee Per Gas: ${feeData.maxFeePerGas} wei`);
    console.log(`⚡ Max Priority Fee: ${feeData.maxPriorityFeePerGas} wei`);

    console.log('\n✅ All basic tests completed successfully!');

    // Check if we have enough balance for a small test transaction
    const balanceInWei = BigInt(balance) * BigInt(10**18);
    const minRequiredBalance = BigInt(10**16); // 0.01 SEI

    if (balanceInWei > minRequiredBalance) {
      console.log('\n💡 Sufficient balance detected. Ready for transaction tests.');
      console.log('   (Transaction tests can be enabled manually)');
    } else {
      console.log('\n⚠️  Insufficient balance for transaction tests.');
      console.log(`   Current: ${balance} SEI`);
      console.log('   Required: 0.01+ SEI for safe testing');
    }

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    logger.error('Mainnet test failed', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testMainnet()
    .then(() => {
      console.log('\n🎉 Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}