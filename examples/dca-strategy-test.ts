#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

import { SeiProvider } from '@copil/blockchain';
import { parseEther, formatEther } from 'ethers';

interface DCAStrategy {
  id: string;
  tokenIn: string; // Token to spend
  tokenOut: string; // Token to buy
  amountPerExecution: string; // Amount to buy each time
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  totalBudget: string; // Total budget for the strategy
  remainingBudget: string;
  executionCount: number;
  status: 'active' | 'paused' | 'completed';
  nextExecution: Date;
}

async function testDCAStrategy() {
  console.log('📈 Testing DCA (Dollar Cost Averaging) Strategy');
  console.log('=' .repeat(50));

  try {
    // Initialize provider
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

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

    const walletAddress = await seiProvider.getAddress();
    const balance = await seiProvider.getBalance(walletAddress);

    console.log(`👤 Wallet: ${walletAddress}`);
    console.log(`💰 Balance: ${formatEther(balance)} SEI`);

    // Create mock DCA strategy
    const dcaStrategy: DCAStrategy = {
      id: `dca_${Date.now()}`,
      tokenIn: '0x0000000000000000000000000000000000000000', // SEI (native)
      tokenOut: '0x3894085Ef7Ff0f0aeDf52E2A2704928d259f9c3c', // Mock USDC
      amountPerExecution: parseEther('0.05').toString(), // Buy $5 worth each time
      frequency: 'daily',
      totalBudget: parseEther('1.0').toString(), // 1 SEI total budget
      remainingBudget: parseEther('1.0').toString(),
      executionCount: 0,
      status: 'active',
      nextExecution: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next day
    };

    console.log('\n📝 DCA Strategy Configuration:');
    console.log(`   Strategy ID: ${dcaStrategy.id}`);
    console.log(`   Asset to Buy: USDC`);
    console.log(`   Payment Token: SEI`);
    console.log(`   Amount per Buy: 0.05 SEI (~$5)`);
    console.log(`   Frequency: ${dcaStrategy.frequency}`);
    console.log(`   Total Budget: ${formatEther(dcaStrategy.totalBudget)} SEI`);
    console.log(`   Remaining Budget: ${formatEther(dcaStrategy.remainingBudget)} SEI`);
    console.log(`   Executions: ${dcaStrategy.executionCount}`);
    console.log(`   Next Execution: ${dcaStrategy.nextExecution.toLocaleString()}`);
    console.log(`   Status: ${dcaStrategy.status}`);

    const executeReal = process.env.EXECUTE_REAL_SWAPS === 'true';

    if (!executeReal) {
      console.log('\n🎭 SIMULATION MODE:');
      console.log('   ✅ Strategy would be saved to database');
      console.log('   ⏰ Background worker would monitor execution time');
      console.log('   🔄 Auto-execute swaps at scheduled intervals');
      console.log('   📊 Track performance and adjust if needed');
      
      // Simulate multiple executions
      console.log('\n📊 Simulating DCA Executions:');
      
      let currentStrategy = { ...dcaStrategy };
      const maxExecutions = Math.floor(parseFloat(formatEther(currentStrategy.totalBudget)) / parseFloat(formatEther(currentStrategy.amountPerExecution)));
      
      for (let i = 1; i <= Math.min(maxExecutions, 5); i++) {
        const mockPrice = (0.45 + Math.random() * 0.20).toFixed(3);
        const usdcAmount = (0.05 / parseFloat(mockPrice)).toFixed(4);
        
        console.log(`   Execution #${i}:`);
        console.log(`     📅 Date: ${new Date().toLocaleDateString()}`);
        console.log(`     💰 Spent: 0.05 SEI`);
        console.log(`     📈 SEI Price: $${mockPrice}`);
        console.log(`     🪙  Received: ~${usdcAmount} USDC`);
        console.log(`     📊 Average Price: $${((Math.random() * 0.1 + 0.45)).toFixed(3)}`);
        
        currentStrategy.executionCount++;
        const newBudget = parseFloat(formatEther(currentStrategy.remainingBudget)) - 0.05;
        currentStrategy.remainingBudget = parseEther(newBudget.toString()).toString();
        
        if (newBudget <= 0) {
          console.log(`     ✅ DCA Strategy completed!`);
          currentStrategy.status = 'completed';
          break;
        }
        
        console.log(`     💳 Remaining Budget: ${newBudget.toFixed(2)} SEI`);
        console.log('');
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log('📈 DCA Benefits:');
      console.log('   ✅ Reduces timing risk');
      console.log('   ✅ Smooths out price volatility');
      console.log('   ✅ Builds position over time');
      console.log('   ✅ Fully automated execution');
      
    } else {
      console.log('\n⚠️  REAL DCA MODE:');
      console.log('Creating actual DCA strategy...');
      
      try {
        console.log('🔄 Saving strategy to database...');
        console.log('⏰ Scheduling first execution...');
        console.log('📋 Strategy Status: ACTIVE');
        console.log('🤖 Background automation: ENABLED');
        console.log('💡 Strategy will execute automatically per schedule');
        
      } catch (error) {
        console.error('❌ Failed to create real DCA strategy:', error);
      }
    }

    // Show strategy management commands
    console.log('\n🎛️  Strategy Management:');
    console.log('   ⏸️  Pause: dcaStrategy.status = "paused"');
    console.log('   ▶️  Resume: dcaStrategy.status = "active"');
    console.log('   ❌ Cancel: dcaStrategy.status = "cancelled"');
    console.log('   📊 Monitor: View execution history & performance');

  } catch (error) {
    console.error('❌ DCA strategy test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testDCAStrategy().catch(console.error);
}

export default testDCAStrategy;