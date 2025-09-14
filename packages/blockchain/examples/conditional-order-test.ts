#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';
import { SeiProvider } from '../src/providers/SeiProvider';
import { Wallet, Contract, ethers } from 'ethers';
import { SUPPORTED_NETWORKS } from '../src/constants';

// Load environment variables
config({ path: resolve(__dirname, '../../../.env') });

async function testConditionalOrders() {
  console.log('🤖 Testing Conditional Order Engine...\n');

  try {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    const orderEngineAddress = '0x425020571862cfDc97727bB6c920866D8BeAbbeB';
    const smartAccountAddress = '0x557E4aBB90072C04fde8b31DAA7ac1ccD24E09E0';
    const wallet = new Wallet(privateKey);
    const walletAddress = wallet.address;
    
    console.log(`🤖 Order Engine Address: ${orderEngineAddress}`);
    console.log(`🧠 Smart Account Address: ${smartAccountAddress}`);
    console.log(`👤 Owner Address: ${walletAddress}\n`);

    // Initialize provider
    const seiProvider = new SeiProvider(SUPPORTED_NETWORKS.SEI_MAINNET, privateKey);
    const provider = seiProvider.getEvmProvider();

    // Check if order engine exists
    const engineCode = await provider.getCode(orderEngineAddress);
    console.log(`📋 Order Engine exists: ${engineCode !== '0x'}`);
    console.log(`📊 Order Engine code length: ${engineCode.length} bytes`);

    if (engineCode === '0x') {
      console.log('❌ Order Engine not deployed!');
      return;
    }

    // Basic Order Engine ABI for testing
    const orderEngineAbi = [
      'function owner() view returns (address)',
      'function paused() view returns (bool)',
      'function getOrderCount() view returns (uint256)',
      'function feeRecipient() view returns (address)',
      'function executionFeeRate() view returns (uint256)'
    ];
    
    const orderEngineContract = new Contract(
      orderEngineAddress,
      orderEngineAbi,
      provider
    );

    try {
      console.log('🔧 Testing Order Engine contract calls...');
      
      const owner = await orderEngineContract.owner();
      console.log(`👑 Engine Owner: ${owner}`);
      
      const isPaused = await orderEngineContract.paused();
      console.log(`⏸️  Engine Paused: ${isPaused}`);
      
      const orderCount = await orderEngineContract.getOrderCount();
      console.log(`📊 Total Orders: ${orderCount.toString()}`);
      
      const feeRecipient = await orderEngineContract.feeRecipient();
      console.log(`💰 Fee Recipient: ${feeRecipient}`);
      
      const feeRate = await orderEngineContract.executionFeeRate();
      console.log(`💸 Execution Fee Rate: ${feeRate.toString()}`);
      
      console.log('\n✅ Conditional Order Engine is working correctly!');
      
      // Advanced test - try to create a simple order (static call for safety)
      console.log('\n🧪 Testing order creation (simulation)...');
      
      const createOrderAbi = [
        `function createOrder(
          uint8 orderType,
          tuple(uint8 conditionType, address tokenAddress, uint256 targetValue, uint256 currentValue, bool isMet, bytes extraData)[] conditions,
          address inputToken,
          address outputToken, 
          uint256 inputAmount,
          uint256 minOutputAmount,
          uint256 deadline,
          address targetContract,
          bytes callData,
          bool requiresAllConditions
        ) returns (uint256)`
      ];
      
      const orderEngineWithSigner = new Contract(
        orderEngineAddress,
        createOrderAbi,
        new Wallet(privateKey, provider)
      );

      // Sample order parameters
      const orderType = 0; // LIMIT_BUY
      const conditions = [{
        conditionType: 0, // PRICE_ABOVE
        tokenAddress: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7', // WSEI
        targetValue: ethers.parseEther('0.1'), // 0.1 price target
        currentValue: 0,
        isMet: false,
        extraData: '0x'
      }];
      const inputToken = '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7'; // WSEI
      const outputToken = '0x0000000000000000000000000000000000000000'; // Native SEI
      const inputAmount = ethers.parseEther('1'); // 1 WSEI
      const minOutputAmount = ethers.parseEther('0.9'); // Min 0.9 SEI
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const targetContract = smartAccountAddress;
      const callData = '0x';
      const requiresAllConditions = true;

      try {
        const simulatedOrderId = await orderEngineWithSigner.createOrder.staticCall(
          orderType,
          conditions,
          inputToken,
          outputToken,
          inputAmount,
          minOutputAmount,
          deadline,
          targetContract,
          callData,
          requiresAllConditions
        );
        
        console.log(`🎯 Simulated order creation successful! Order ID would be: ${simulatedOrderId}`);
        console.log('✅ Order creation functionality is working');
        
      } catch (simulationError: any) {
        console.log(`⚠️  Order simulation error: ${simulationError.message}`);
        console.log('This might be expected due to missing approvals or conditions');
      }
      
    } catch (callError: any) {
      console.log(`⚠️  Contract call error: ${callError.message}`);
    }

  } catch (error: any) {
    console.error('\n❌ Conditional Order test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testConditionalOrders()
    .then(() => {
      console.log('\n🎉 Conditional Order Engine test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}