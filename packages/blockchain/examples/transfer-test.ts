#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';
import { SeiClient } from '../src/clients/SeiClient';
import { logger } from '../src/utils/Logger';
import { Wallet, parseEther, formatEther } from 'ethers';
import { SUPPORTED_NETWORKS } from '../src/constants';

// Load environment variables
config({ path: resolve(__dirname, '../../../.env') });

async function testTransfer() {
  console.log('💸 Starting SEI Transfer Test...\n');

  try {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    const wallet = new Wallet(privateKey);
    const senderAddress = wallet.address;

    // Test recipient (sending to self for safety)
    const recipientAddress = senderAddress;
    const transferAmount = '0.001'; // 0.001 SEI

    console.log(`👤 Sender: ${senderAddress}`);
    console.log(`🎯 Recipient: ${recipientAddress}`);
    console.log(`💰 Amount: ${transferAmount} SEI\n`);

    // Initialize client
    const seiClient = new SeiClient({
      network: SUPPORTED_NETWORKS.SEI_MAINNET,
      privateKey: privateKey
    });

    // Check initial balance
    console.log('📊 Checking initial balance...');
    const initialBalance = await seiClient.getBalance(senderAddress);
    console.log(`💰 Initial Balance: ${formatEther(initialBalance)} SEI`);

    // Get gas estimate
    const provider = seiClient.getProvider().getEvmProvider();
    const transferValue = parseEther(transferAmount);

    // Estimate gas for the transfer
    const gasEstimate = await provider.estimateGas({
      to: recipientAddress,
      value: transferValue
    });

    const feeData = await provider.getFeeData();
    const estimatedFee = gasEstimate * (feeData.gasPrice || BigInt(1100000000));

    console.log(`⛽ Estimated Gas: ${gasEstimate.toString()}`);
    console.log(`💸 Estimated Fee: ${formatEther(estimatedFee)} SEI`);

    // Check if we have enough balance
    const requiredAmount = transferValue + estimatedFee;
    const currentBalanceWei = BigInt(initialBalance);

    if (currentBalanceWei < requiredAmount) {
      console.log('\n⚠️  Insufficient balance for transfer!');
      console.log(`Required: ${formatEther(requiredAmount)} SEI`);
      console.log(`Available: ${formatEther(currentBalanceWei)} SEI`);
      return;
    }

    // Execute transfer
    console.log('\n🚀 Executing transfer...');
    
    const walletWithProvider = new Wallet(privateKey, provider);
    
    const tx = await walletWithProvider.sendTransaction({
      to: recipientAddress,
      value: transferValue,
      gasLimit: gasEstimate,
      gasPrice: feeData.gasPrice
    });

    console.log(`📝 Transaction Hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block: ${receipt?.blockNumber}`);
    console.log(`⛽ Gas Used: ${receipt?.gasUsed.toString()}`);
    console.log(`💸 Actual Fee: ${formatEther(receipt?.gasUsed * (receipt?.gasPrice || BigInt(0)))} SEI`);

    // Check final balance
    console.log('\n📊 Checking final balance...');
    const finalBalance = await seiClient.getBalance(senderAddress);
    console.log(`💰 Final Balance: ${formatEther(finalBalance)} SEI`);

    const difference = currentBalanceWei - BigInt(finalBalance);
    console.log(`📉 Balance Change: -${formatEther(difference)} SEI`);

    console.log('\n✅ Transfer test completed successfully!');

  } catch (error: any) {
    console.error('\n❌ Transfer test failed:', error.message);
    logger.error('Transfer test failed', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testTransfer()
    .then(() => {
      console.log('\n🎉 Transfer test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}