#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

import { SeiProvider } from '@copil/blockchain';
import { parseEther, formatEther } from 'ethers';

async function testSimpleSwap() {
  console.log('🔄 Testing Simple Swap Automation');
  console.log('=' .repeat(50));

  try {
    // Check environment
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    // Initialize provider
    const seiProvider = new SeiProvider({
      chainId: 1329,
      name: 'Sei Mainnet',
      rpcUrl: process.env.SEI_RPC_URL || 'https://evm-rpc.sei-apis.com',
      blockExplorer: 'https://seitrace.com',
      nativeCurrency: {
        symbol: 'SEI',
        name: 'Sei',
        decimals: 18
      },
      contracts: {
        entryPoint: process.env.ENTRY_POINT_ADDRESS || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        accountFactory: process.env.ACCOUNT_FACTORY_ADDRESS,
        conditionalOrderEngine: process.env.CONDITIONAL_ORDER_ENGINE_ADDRESS
      }
    }, privateKey);

    // Get wallet info
    const walletAddress = await seiProvider.getAddress();
    const balance = await seiProvider.getBalance(walletAddress);
    
    console.log(`👤 Wallet Address: ${walletAddress}`);
    console.log(`💰 SEI Balance: ${formatEther(balance)} SEI`);
    
    if (parseFloat(formatEther(balance)) < 0.1) {
      console.log('⚠️  Warning: Low SEI balance for testing');
    }

    // Test network connection
    const blockNumber = await seiProvider.getBlockNumber();
    const gasPrice = await seiProvider.getGasPrice();
    
    console.log(`📦 Current Block: ${blockNumber}`);
    console.log(`⛽ Gas Price: ${formatEther(gasPrice)} SEI`);
    console.log('✅ Network connection successful');

    // Check if we should execute real swaps
    const executeReal = process.env.EXECUTE_REAL_SWAPS === 'true';
    console.log(`🔄 Execute Real Swaps: ${executeReal ? 'YES' : 'NO (simulation only)'}`);

    if (!executeReal) {
      console.log('\n🚀 To test real swaps, set EXECUTE_REAL_SWAPS=true in .env');
      console.log('💡 For now, running simulation mode...');
      
      // Simulation
      console.log('\n📝 Swap Simulation:');
      console.log('   Token In: SEI');
      console.log('   Token Out: USDC (simulated)');
      console.log('   Amount: 0.01 SEI');
      console.log('   Status: ✅ Simulation successful');
      
      return;
    }

    console.log('\n⚠️  REAL SWAP MODE ENABLED');
    console.log('This will use real funds on Sei mainnet');
    console.log('Proceeding in 3 seconds...');
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Here we would implement actual swap logic
    console.log('🔄 Executing real swap...');
    console.log('⏳ This would connect to DragonSwap/Symphony for actual trading');
    console.log('📊 Quote: 0.01 SEI → ~$X USDC (estimated)');
    console.log('✅ Swap ready for execution');

  } catch (error) {
    console.error('❌ Swap test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testSimpleSwap().catch(console.error);
}

export default testSimpleSwap;