#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

import { SeiProvider, SEI_MAINNET, DexExecutor, ConditionalOrderEngineContract } from '@copil/blockchain';
import { createDeFiAgent, DEFAULT_AGENT_CONFIG } from '@copil/ai-agent';

async function aiAgentDemo() {
  console.log('🤖 Copil AI Agent Demo');
  console.log('🌐 Sei Network DeFi Assistant');
  console.log('=' .repeat(50));

  try {
    // Check required environment variables
    const privateKey = process.env.PRIVATE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    if (!privateKey) {
      console.log('❌ PRIVATE_KEY not found in environment');
      console.log('Please add your SEI wallet private key to .env file');
      process.exit(1);
    }

    if (!openaiApiKey) {
      console.log('⚠️  OPENAI_API_KEY not found - AI features will be limited');
      console.log('Add your OpenAI API key for full AI functionality');
    }

    console.log('🔧 Initializing Copil AI Agent...');

    // Initialize blockchain components
    const seiProvider = new SeiProvider(SEI_MAINNET, privateKey);
    const walletAddress = seiProvider.getAddress();
    
    console.log(`👤 Wallet Address: ${walletAddress}`);

    // Initialize smart contracts
    const orderEngineAddress = process.env.CONDITIONAL_ORDER_ENGINE_ADDRESS || 
      '0x425020571862cfDc97727bB6c920866D8BeAbbeB';
    
    const orderEngine = new ConditionalOrderEngineContract(
      seiProvider,
      orderEngineAddress
    );

    // Initialize DEX executor
    const dexExecutor = new DexExecutor(seiProvider, orderEngine);

    // Initialize AI agent
    const agentConfig = {
      ...DEFAULT_AGENT_CONFIG,
      openaiApiKey: openaiApiKey || '',
      verbose: true
    };

    const agent = createDeFiAgent(
      agentConfig,
      seiProvider,
      dexExecutor,
      orderEngine
    );

    console.log('✅ AI Agent initialized successfully!');
    console.log('');

    // Show agent capabilities
    const capabilities = agent.getCapabilities();
    console.log('🎯 Agent Capabilities:');
    console.log(`   Operations: ${capabilities.operations.join(', ')}`);
    console.log(`   DEX Support: ${capabilities.supportedDEXes.join(', ')}`);
    console.log(`   Tokens: ${capabilities.supportedTokens.join(', ')}`);
    console.log('');

    // Demo conversations
    const demoConversations = [
      'What is my SEI balance?',
      'Show me my token balances',
      'Swap 1 SEI for USDC with 1% slippage',
      'Create a limit order to buy SEI when the price drops to $1.50',
      'Set up DCA to buy $100 worth of SEI every week for 2 months',
      'What are my active orders?',
    ];

    console.log('💬 Demo Conversations:');
    console.log('-'.repeat(30));

    for (const [index, message] of demoConversations.entries()) {
      console.log(`\\n👤 User: ${message}`);
      
      try {
        if (openaiApiKey) {
          // Use full AI agent if API key is available
          const response = await agent.chat(message, {
            userId: 'demo-user',
            sessionId: 'demo-session',
            walletAddress
          });

          console.log(`🤖 Copil: ${response.message}`);
          
          if (response.transactionHash) {
            console.log(`   📝 Transaction: ${response.transactionHash}`);
          }
          
          if (response.suggestions && response.suggestions.length > 0) {
            console.log(`   💡 Suggestions: ${response.suggestions.join(', ')}`);
          }
          
          if (response.error) {
            console.log(`   ⚠️  Error: ${response.error}`);
          }
        } else {
          // Simulate responses without OpenAI
          console.log(`🤖 Copil: [Demo Mode] I understand you want to: ${message}`);
          console.log('   💡 Add OPENAI_API_KEY for full AI functionality');
        }

        // Add delay between conversations
        if (index < demoConversations.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.log(`❌ Error: ${error instanceof Error ? error.message : error}`);
      }
    }

    console.log('\\n' + '='.repeat(50));
    console.log('🎉 Demo completed successfully!');
    console.log('🚀 Your Copil AI Agent is ready for production');
    console.log('\\n📚 Integration Guide:');
    console.log('   - Add to your frontend with our React components');
    console.log('   - Integrate via REST API or WebSocket');
    console.log('   - Customize agent behavior and add new tools');
    console.log('   - Deploy with Docker or Kubernetes');

  } catch (error) {
    console.error('\\n❌ Demo failed:', error instanceof Error ? error.message : error);
    console.log('\\n🔧 Troubleshooting:');
    console.log('   - Check your .env file configuration');
    console.log('   - Ensure wallet has SEI balance for gas fees');
    console.log('   - Verify smart contracts are deployed');
    console.log('   - Check network connectivity');
    process.exit(1);
  }
}

// Handle process signals gracefully
process.on('SIGINT', () => {
  console.log('\\n👋 Goodbye! Thanks for trying Copil AI Agent');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\\n👋 Goodbye! Thanks for trying Copil AI Agent');
  process.exit(0);
});

// Run demo
if (require.main === module) {
  aiAgentDemo().catch(console.error);
}

export { aiAgentDemo };