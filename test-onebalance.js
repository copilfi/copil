#!/usr/bin/env node

/**
 * OneBalance API Test Script
 * Tests the OneBalance integration to verify API connectivity and functionality
 */

const API_KEY = '42bb629272001ee1163ca0dbbbc07bcbb0ef57a57baf16c4b1d4672db4562c11';
const BASE_URL = 'https://be.onebalance.io/api';

async function testOneBalanceAPI() {
  console.log('🔍 OneBalance API Test Suite\n');
  console.log('=' .repeat(60));

  // Test 1: List Supported Chains
  console.log('\n📡 Test 1: Listing Supported Chains');
  console.log('-'.repeat(60));
  try {
    const response = await fetch(`${BASE_URL}/chains/supported-list`, {
      headers: { 'x-api-key': API_KEY }
    });
    const chains = await response.json();
    console.log(`✅ Success: Found ${chains.length} supported chains`);
    console.log('Sample chains:');
    chains.slice(0, 5).forEach(c => {
      console.log(`  - ${c.chain.chain} ${c.isTestnet ? '(testnet)' : '(mainnet)'}`);
    });
  } catch (error) {
    console.error(`❌ Failed: ${error.message}`);
  }

  // Test 2: List Aggregated Assets
  console.log('\n💰 Test 2: Listing Aggregated Assets');
  console.log('-'.repeat(60));
  try {
    const response = await fetch(`${BASE_URL}/assets/list`, {
      headers: { 'x-api-key': API_KEY }
    });
    const assets = await response.json();
    console.log(`✅ Success: Found ${assets.length} aggregated assets`);
    console.log('Sample assets:');
    assets.slice(0, 5).forEach(asset => {
      console.log(`  - ${asset.symbol} (${asset.aggregatedAssetId}): ${asset.name}`);
      console.log(`    Decimals: ${asset.decimals}, Entities: ${asset.aggregatedEntities.length} chains`);
    });
  } catch (error) {
    console.error(`❌ Failed: ${error.message}`);
  }

  // Test 3: Get Aggregated Balance (test address)
  console.log('\n💼 Test 3: Getting Aggregated Balance');
  console.log('-'.repeat(60));
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // Example from docs
  try {
    const response = await fetch(
      `${BASE_URL}/v3/balances/aggregated-balance?accounts=${testAddress}`,
      { headers: { 'x-api-key': API_KEY } }
    );
    const balance = await response.json();
    
    if (balance.balances && balance.balances.length > 0) {
      console.log(`✅ Success: Found balances for ${testAddress}`);
      console.log(`Total assets: ${balance.balances.length}`);
      balance.balances.slice(0, 3).forEach(b => {
        console.log(`  - ${b.symbol}: ${b.amount} (${b.amountUsd} USD)`);
      });
    } else {
      console.log(`⚠️  No balances found for test address (this is normal if address has no funds)`);
    }
  } catch (error) {
    console.error(`❌ Failed: ${error.message}`);
  }

  // Test 4: Quote Request (simple swap simulation)
  console.log('\n🔄 Test 4: Getting Quote for Swap');
  console.log('-'.repeat(60));
  try {
    const quoteRequest = {
      accounts: [{ address: testAddress }],
      source: {
        asset: 'ob:usdc',
        amount: '1000000' // 1 USDC (6 decimals)
      },
      destination: {
        asset: 'ob:eth'
      },
      slippageTolerance: 50 // 0.5%
    };

    const response = await fetch(`${BASE_URL}/v3/quote`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(quoteRequest)
    });

    const quote = await response.json();
    
    if (quote.quoteId) {
      console.log(`✅ Success: Received quote ${quote.quoteId}`);
      console.log(`  From: ${quoteRequest.source.amount} USDC`);
      if (quote.estimatedOutput) {
        console.log(`  To: ${quote.estimatedOutput.amount} ETH`);
        console.log(`  Estimated USD: $${quote.estimatedOutput.amountUsd || 'N/A'}`);
      }
      if (quote.gasCost) {
        console.log(`  Gas Cost: $${quote.gasCost.amountUsd || 'N/A'}`);
      }
    } else {
      console.log(`⚠️  Quote response: ${JSON.stringify(quote).substring(0, 200)}...`);
    }
  } catch (error) {
    console.error(`❌ Failed: ${error.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✨ OneBalance API Test Complete\n');
}

// Run the tests
testOneBalanceAPI().catch(console.error);
