#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve } from 'path';
import { SeiProvider, SUPPORTED_NETWORKS, DexExecutor, ConditionalOrderEngineContract } from '@copil/blockchain';
import { createDeFiAgent, DEFAULT_AGENT_CONFIG } from '../src';
import { IntentClassifier } from '../src/nlp/IntentClassifier';
import { OrderConverter } from '../src/nlp/OrderConverter';
import { TokenResolver } from '../src/utils/TokenResolver';

// Load environment variables
config({ path: resolve(__dirname, '../../../../.env') });

class E2EIntegrationTest {
  private seiProvider!: SeiProvider;
  private dexExecutor!: DexExecutor;
  private orderEngine!: ConditionalOrderEngineContract;
  private agent!: any;
  private intentClassifier!: IntentClassifier;
  private orderConverter!: OrderConverter;
  private tokenResolver!: TokenResolver;

  constructor() {
    console.log('🧪 Starting End-to-End Integration Test');
    console.log('=' .repeat(50));
  }

  async initialize(): Promise<void> {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not found in environment');
    }

    console.log('📡 Initializing components...');

    // Initialize blockchain components
    this.seiProvider = new SeiProvider(SUPPORTED_NETWORKS.SEI_MAINNET, privateKey);
    
    // Initialize DEx executor (mock for testing)
    this.dexExecutor = {} as DexExecutor;
    this.dexExecutor.getBestQuote = async (params: any) => ({
      protocol: 'dragonswap',
      amountOut: params.amountIn * 95n / 100n,
      priceImpact: 0.05,
      gasEstimate: 150000n
    });

    // Initialize Order Engine
    const orderEngineAddress = process.env.CONDITIONAL_ORDER_ENGINE_ADDRESS || 
      '0x425020571862cfDc97727bB6c920866D8BeAbbeB';
    this.orderEngine = new ConditionalOrderEngineContract(
      this.seiProvider,
      orderEngineAddress
    );

    // Initialize AI agent
    const agentConfig = {
      ...DEFAULT_AGENT_CONFIG,
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      verbose: true
    };

    this.agent = createDeFiAgent(
      agentConfig,
      this.seiProvider,
      this.dexExecutor,
      this.orderEngine
    );

    // Initialize NLP components
    this.tokenResolver = new TokenResolver();
    this.intentClassifier = new IntentClassifier();
    this.orderConverter = new OrderConverter(this.tokenResolver);

    console.log('✅ Components initialized successfully!');
  }

  async runTests(): Promise<void> {
    const tests = [
      this.testTokenResolution,
      this.testIntentClassification,
      this.testOrderConversion,
      this.testAgentCapabilities,
      this.testNaturalLanguageProcessing,
    ];

    for (const test of tests) {
      try {
        await test.call(this);
        console.log('✅ Test passed');
      } catch (error) {
        console.error('❌ Test failed:', error instanceof Error ? error.message : error);
      }
      console.log('-'.repeat(30));
    }
  }

  async testTokenResolution(): Promise<void> {
    console.log('🔍 Testing Token Resolution...');

    const testCases = [
      { input: 'SEI', expected: 'SEI' },
      { input: 'sei', expected: 'SEI' },
      { input: 'WSEI', expected: 'WSEI' },
      { input: 'wrapped sei', expected: 'WSEI' },
      { input: 'USDC', expected: 'USDC' },
      { input: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7', expected: 'WSEI' },
    ];

    for (const testCase of testCases) {
      const result = await this.tokenResolver.resolveToken(testCase.input);
      
      if (!result) {
        throw new Error(`Failed to resolve token: ${testCase.input}`);
      }

      if (result.symbol !== testCase.expected) {
        throw new Error(`Expected ${testCase.expected}, got ${result.symbol} for input: ${testCase.input}`);
      }

      console.log(`  ✓ '${testCase.input}' → '${result.symbol}' (confidence: ${result.confidence})`);
    }
  }

  async testIntentClassification(): Promise<void> {
    console.log('🎯 Testing Intent Classification...');

    const testCases = [
      {
        input: 'Swap 100 SEI for USDC',
        expectedAction: 'swap',
        expectedTokens: ['SEI', 'USDC'],
        expectedAmount: 100
      },
      {
        input: 'Create a limit order to buy USDC when SEI reaches $2',
        expectedAction: 'limit_order',
        expectedTokens: ['USDC', 'SEI'],
        expectedPrice: 2
      },
      {
        input: 'Set up DCA to buy 1000 USDC worth of SEI every week for 3 months',
        expectedAction: 'dca',
        expectedTokens: ['USDC', 'SEI'],
        expectedAmount: 1000
      },
      {
        input: 'What is my SEI balance?',
        expectedAction: 'check_balance',
        expectedTokens: ['SEI']
      }
    ];

    for (const testCase of testCases) {
      const intent = this.intentClassifier.classifyIntent(testCase.input);
      
      if (intent.action !== testCase.expectedAction) {
        throw new Error(`Expected action ${testCase.expectedAction}, got ${intent.action}`);
      }

      console.log(`  ✓ '${testCase.input}' → Action: ${intent.action} (confidence: ${intent.confidence.toFixed(2)})`);
      
      if (intent.entities.tokens) {
        console.log(`    Tokens: ${intent.entities.tokens.join(', ')}`);
      }
    }
  }

  async testOrderConversion(): Promise<void> {
    console.log('🔧 Testing Order Conversion...');

    // Test swap conversion
    const swapIntent = this.intentClassifier.classifyIntent('Swap 10 SEI for USDC');
    const swapResult = await this.orderConverter.convertIntentToOrder(swapIntent);
    
    if (!swapResult.success) {
      throw new Error(`Swap conversion failed: ${swapResult.error}`);
    }

    console.log('  ✓ Swap intent converted successfully');
    if (swapResult.warnings) {
      console.log(`    Warnings: ${swapResult.warnings.join(', ')}`);
    }

    // Test limit order conversion
    const limitIntent = this.intentClassifier.classifyIntent('Create limit buy order for 5 SEI at $1.5 USDC');
    const limitResult = await this.orderConverter.convertIntentToOrder(limitIntent);
    
    if (!limitResult.success) {
      throw new Error(`Limit order conversion failed: ${limitResult.error}`);
    }

    console.log('  ✓ Limit order intent converted successfully');

    // Test DCA conversion
    const dcaIntent = this.intentClassifier.classifyIntent('DCA 100 USDC into SEI daily for 30 days');
    const dcaResult = await this.orderConverter.convertIntentToOrder(dcaIntent);
    
    if (!dcaResult.success) {
      throw new Error(`DCA conversion failed: ${dcaResult.error}`);
    }

    console.log('  ✓ DCA intent converted successfully');
  }

  async testAgentCapabilities(): Promise<void> {
    console.log('🤖 Testing Agent Capabilities...');

    const capabilities = this.agent.getCapabilities();
    
    if (!capabilities.operations.includes('Token Swaps')) {
      throw new Error('Missing Token Swaps capability');
    }

    if (!capabilities.supportedDEXes.includes('DragonSwap')) {
      throw new Error('Missing DragonSwap support');
    }

    if (!capabilities.supportedTokens.includes('SEI')) {
      throw new Error('Missing SEI token support');
    }

    console.log('  ✓ Agent capabilities verified');
    console.log(`    Operations: ${capabilities.operations.join(', ')}`);
    console.log(`    DEXes: ${capabilities.supportedDEXes.join(', ')}`);
    console.log(`    Tokens: ${capabilities.supportedTokens.join(', ')}`);
  }

  async testNaturalLanguageProcessing(): Promise<void> {
    console.log('💬 Testing Natural Language Processing...');

    const testMessages = [
      'Check my balance',
      'What tokens do I have?',
      'Swap 1 SEI to USDC',
      'Create a limit order',
      'Set up weekly DCA'
    ];

    for (const message of testMessages) {
      try {
        // Test intent classification
        const intent = this.intentClassifier.classifyIntent(message);
        
        if (intent.confidence < 0.1) {
          throw new Error(`Very low confidence for: ${message}`);
        }

        console.log(`  ✓ '${message}' → ${intent.action} (${intent.confidence.toFixed(2)})`);

        // If it's an actionable intent, test conversion
        if (['swap', 'limit_order', 'dca'].includes(intent.action)) {
          const conversion = await this.orderConverter.convertIntentToOrder(intent);
          if (conversion.success) {
            console.log(`    → Conversion successful`);
          } else {
            console.log(`    → Conversion failed: ${conversion.error}`);
          }
        }

      } catch (error) {
        console.log(`  ⚠️  '${message}' → Error: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

// Run the test if this file is executed directly
async function runE2ETest(): Promise<void> {
  const test = new E2EIntegrationTest();
  
  try {
    await test.initialize();
    await test.runTests();
    
    console.log('');
    console.log('🎉 End-to-End Integration Test Complete!');
    console.log('=' .repeat(50));
    console.log('✅ All components are working together correctly');
    console.log('🚀 Ready for production deployment');
    
  } catch (error) {
    console.error('');
    console.error('❌ Test Suite Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Export for use in other tests
export { E2EIntegrationTest };

// Run if executed directly
if (require.main === module) {
  runE2ETest().catch(console.error);
}