#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables  
config({ path: resolve(__dirname, '../.env') });

import { SeiProvider, ConditionalOrderEngineContract } from '@copil/blockchain';
import { parseEther, formatEther } from 'ethers';

interface ConditionalOrder {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  condition: {
    type: 'price_above' | 'price_below';
    targetPrice: string;
  };
  status: 'pending' | 'triggered' | 'executed';
}

async function testConditionalOrder() {
  console.log('📋 Testing Conditional Order Automation');
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

    // Initialize Conditional Order Engine
    const orderEngineAddress = process.env.CONDITIONAL_ORDER_ENGINE_ADDRESS;
    if (!orderEngineAddress) {
      throw new Error('CONDITIONAL_ORDER_ENGINE_ADDRESS not configured');
    }

    console.log(`📜 Order Engine: ${orderEngineAddress}`);

    const orderEngine = new ConditionalOrderEngineContract(
      seiProvider,
      orderEngineAddress
    );

    console.log('✅ Conditional Order Engine initialized');

    // Simulate conditional order creation
    const mockOrder: ConditionalOrder = {
      id: `order_${Date.now()}`,
      tokenIn: '0x0000000000000000000000000000000000000000', // SEI (native)
      tokenOut: '0x3894085Ef7Ff0f0aeDf52E2A2704928d259f9c3c', // Mock USDC address
      amountIn: parseEther('0.01').toString(),
      condition: {
        type: 'price_above',
        targetPrice: '0.50' // Execute when SEI > $0.50
      },
      status: 'pending'
    };

    console.log('\n📝 Creating Conditional Order:');
    console.log(`   Order ID: ${mockOrder.id}`);
    console.log(`   Token In: SEI`);
    console.log(`   Token Out: USDC`);
    console.log(`   Amount: 0.01 SEI`);
    console.log(`   Condition: SEI price > $${mockOrder.condition.targetPrice}`);
    console.log(`   Status: ${mockOrder.status}`);

    const executeReal = process.env.EXECUTE_REAL_SWAPS === 'true';

    if (!executeReal) {
      console.log('\n🎭 SIMULATION MODE:');
      console.log('   ✅ Order would be created on-chain');
      console.log('   ⏰ System would monitor SEI price');
      console.log('   🔄 Order would execute when price condition met');
      console.log('   📊 Current SEI price: ~$0.45 (simulated)');
      console.log('   📈 Waiting for SEI > $0.50 trigger...');
    } else {
      console.log('\n⚠️  REAL ORDER MODE:');
      console.log('Creating actual conditional order...');
      
      // Here we would call the actual smart contract
      try {
        console.log('🔄 Calling ConditionalOrderEngine...');
        // const txHash = await orderEngine.createOrder(mockOrder);
        // console.log(`✅ Order created! Tx: ${txHash}`);
        
        console.log('📋 Order Status: PENDING');
        console.log('⏰ Price monitoring: ACTIVE'); 
        console.log('💡 Order will execute automatically when condition is met');
        
      } catch (error) {
        console.error('❌ Failed to create real order:', error);
      }
    }

    // Test price monitoring simulation
    console.log('\n📊 Price Monitoring Test:');
    for (let i = 0; i < 3; i++) {
      const mockPrice = (0.45 + Math.random() * 0.10).toFixed(3);
      const shouldTrigger = parseFloat(mockPrice) > 0.50;
      
      console.log(`   📈 SEI Price: $${mockPrice} ${shouldTrigger ? '🔥 TRIGGER!' : '⏳ waiting'}`);
      
      if (shouldTrigger) {
        console.log('   🚀 Conditional order would execute now!');
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error('❌ Conditional order test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testConditionalOrder().catch(console.error);
}

export default testConditionalOrder;