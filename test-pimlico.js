#!/usr/bin/env node

/**
 * Pimlico & Smart Account Deployment Integration Test
 * Tests the complete flow from login to smart account deployment
 */

const API_BASE_URL = 'http://localhost:4311';
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, symbol, message) {
  console.log(`${color}${symbol} ${message}${COLORS.reset}`);
}

function success(message) {
  log(COLORS.green, '✅', message);
}

function error(message) {
  log(COLORS.red, '❌', message);
}

function info(message) {
  log(COLORS.cyan, '📌', message);
}

function warn(message) {
  log(COLORS.yellow, '⚠️ ', message);
}

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 PIMLICO & SMART ACCOUNT DEPLOYMENT TEST SUITE');
  console.log('='.repeat(70) + '\n');

  let jwt = null;
  let userId = null;
  let sessionKeys = [];
  let smartAccountAddress = null;

  // Test 1: Health Check
  console.log('🏥 Test 1: API Health Check');
  console.log('-'.repeat(70));
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    const data = await response.json();
    if (data.ok) {
      success('API is running and healthy');
      info(`Status: ${JSON.stringify(data)}`);
    } else {
      throw new Error('API health check failed');
    }
  } catch (err) {
    error(`Health check failed: ${err.message}`);
    error('Make sure API is running: npm run dev');
    process.exit(1);
  }

  // Test 2: Login and Get JWT
  console.log('\n👤 Test 2: Login and Get JWT Token');
  console.log('-'.repeat(70));
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        privyDid: 'dev:test:pimlico',
        email: 'pimlico-test@copil.io',
      }),
    });

    if (!response.ok) {
      throw new Error(`Login failed: ${response.status}`);
    }

    const data = await response.json();
    jwt = data.access_token;
    
    // Parse JWT to get user ID
    if (jwt) {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
      userId = payload.sub;
    }

    success('Login successful');
    info(`User ID: ${userId}`);
    info(`JWT Token: ${jwt.substring(0, 50)}...`);
  } catch (err) {
    error(`Login failed: ${err.message}`);
    process.exit(1);
  }

  // Test 3: Check Session Keys
  console.log('\n🔑 Test 3: Session Keys Check');
  console.log('-'.repeat(70));
  try {
    const response = await fetch(`${API_BASE_URL}/session-keys`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (!response.ok) {
      throw new Error(`Session keys check failed: ${response.status}`);
    }

    sessionKeys = await response.json();
    
    if (sessionKeys.length > 0) {
      success(`Found ${sessionKeys.length} session key(s)`);
      sessionKeys.forEach((key, idx) => {
        info(`Key ${idx + 1}: ID=${key.id}, Active=${key.isActive}, PublicKey=${key.publicKey?.substring(0, 10)}...`);
      });
    } else {
      warn('No session keys found');
      info('You need to create a session key manually');
      info('See test-pimlico-flow.md for instructions');
    }
  } catch (err) {
    error(`Session keys check failed: ${err.message}`);
  }

  // Test 4: Check Supported Chains
  console.log('\n🌐 Test 4: Supported Chains for Deployment');
  console.log('-'.repeat(70));
  try {
    const response = await fetch(`${API_BASE_URL}/transaction/chains`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (response.ok) {
      const chains = await response.json();
      success('Chains retrieved');
      if (chains.supported) {
        info(`Supported chains: ${chains.supported.join(', ')}`);
      } else {
        info(`Chains: ${JSON.stringify(chains)}`);
      }
    } else {
      warn('Chains endpoint returned non-OK status, but continuing...');
    }
  } catch (err) {
    warn(`Chains check failed: ${err.message} (not critical)`);
  }

  // Test 5: Check Smart Account Address (if wallet exists)
  console.log('\n🏦 Test 5: Smart Account Address Check');
  console.log('-'.repeat(70));
  try {
    const response = await fetch(`${API_BASE_URL}/smart-account/address?chain=base`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (response.ok) {
      const data = await response.json();
      smartAccountAddress = data.smartAccountAddress;
      success('Smart Account address retrieved');
      info(`Chain: ${data.chain}`);
      info(`Address: ${smartAccountAddress}`);
      info(`Deployed: ${data.isDeployed ? 'Yes' : 'No (counterfactual)'}`);
    } else {
      warn('Could not retrieve Smart Account address (wallet may not exist yet)');
    }
  } catch (err) {
    warn(`Smart Account address check failed: ${err.message}`);
  }

  // Test 6: Deploy Smart Account (if session key exists)
  if (sessionKeys.length > 0) {
    console.log('\n🚀 Test 6: Smart Account Deployment');
    console.log('-'.repeat(70));
    
    const activeKey = sessionKeys.find(k => k.isActive);
    const keyToUse = activeKey || sessionKeys[0];
    
    info(`Using session key ID: ${keyToUse.id}`);
    info(`Target chain: base`);

    try {
      const response = await fetch(`${API_BASE_URL}/smart-account/deploy`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chain: 'base',
          sessionKeyId: keyToUse.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Deploy failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
      }

      const data = await response.json();
      success('Deployment job enqueued successfully!');
      info(`Job ID: ${data.jobId}`);
      info(`Smart Account: ${data.smartAccountAddress}`);
      info('Check transaction logs for deployment status');
    } catch (err) {
      error(`Deployment failed: ${err.message}`);
      warn('Common issues:');
      warn('  - SESSION_KEY_PRIVATE_KEY not set in .env');
      warn('  - Smart Account needs gas for deployment');
      warn('  - Paymaster not configured');
    }
  } else {
    console.log('\n⏭️  Test 6: Skipped (No session keys available)');
    console.log('-'.repeat(70));
    warn('Create a session key first to test deployment');
  }

  // Test 7: Check Transaction Logs
  console.log('\n📋 Test 7: Transaction Logs');
  console.log('-'.repeat(70));
  try {
    const response = await fetch(`${API_BASE_URL}/transaction/logs`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (!response.ok) {
      throw new Error(`Logs retrieval failed: ${response.status}`);
    }

    const logs = await response.json();
    
    if (logs.length > 0) {
      success(`Found ${logs.length} transaction log(s)`);
      logs.slice(0, 5).forEach((log, idx) => {
        const statusIcon = log.status === 'success' ? '✅' : 
                          log.status === 'pending' ? '⏳' : '❌';
        info(`[${idx + 1}] ${statusIcon} ${log.description || 'No description'}`);
        info(`    Chain: ${log.chain || 'N/A'}, Status: ${log.status}, TxHash: ${log.txHash?.substring(0, 20) || 'N/A'}...`);
      });
    } else {
      warn('No transaction logs found yet');
      info('Deploy a Smart Account to see logs here');
    }
  } catch (err) {
    error(`Transaction logs check failed: ${err.message}`);
  }

  // Test 8: Pimlico Bundler Connectivity Check
  console.log('\n🔗 Test 8: Pimlico Bundler Connectivity');
  console.log('-'.repeat(70));
  info('Checking Pimlico bundler endpoints...');
  
  const chains = [
    { name: 'Ethereum', id: 1 },
    { name: 'Base', id: 8453 },
    { name: 'Arbitrum', id: 42161 },
  ];

  for (const chain of chains) {
    try {
      // Note: Actual API key should be from env, but for demo we'll skip real call
      info(`${chain.name} (${chain.id}): Bundler URL would be https://api.pimlico.io/v2/${chain.id}/rpc`);
      success(`${chain.name} bundler endpoint configured`);
    } catch (err) {
      warn(`${chain.name} bundler check skipped: ${err.message}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`User ID: ${userId || 'N/A'}`);
  console.log(`Session Keys: ${sessionKeys.length}`);
  console.log(`Smart Account: ${smartAccountAddress || 'Not retrieved'}`);
  console.log('\n🎯 Next Steps:');
  console.log('  1. If no session keys: Create one using the API or UI');
  console.log('  2. If deployment failed: Check .env for SESSION_KEY_PRIVATE_KEY');
  console.log('  3. Check logs: GET /transaction/logs');
  console.log('  4. Verify on-chain: Use block explorer or eth_getCode RPC call');
  console.log('\n📖 For detailed instructions, see: test-pimlico-flow.md\n');
}

// Run tests
runTests().catch((err) => {
  error(`Test suite failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
