// Test script for Copil AI Agent
const { PrismaClient } = require('@prisma/client');

// Import compiled services
const AIAgentService = require('./dist/services/AIAgentService.js').default;

async function testCopilAgent() {
  try {
    console.log('🤖 Starting Copil AI Agent Test...\n');
    
    // Initialize services
    const prisma = new PrismaClient();
    const aiAgentService = new AIAgentService(prisma);
    
    console.log('📋 Initializing AI Agent Service...');
    await aiAgentService.initialize();
    console.log('✅ AI Agent Service initialized successfully!\n');
    
    // Test cases
    const testMessages = [
      "Hello Copil! Can you check my SEI balance?",
      "I want to swap 10 SEI for USDC",
      "Create a limit order to buy WSEI at 0.5 USDC",
      "Set up a DCA strategy to buy 100 USDC worth of SEI over 30 days"
    ];
    
    console.log('🎯 Testing Copil with various requests:\n');
    
    for (let i = 0; i < testMessages.length; i++) {
      const message = testMessages[i];
      console.log(`\n📨 Test ${i + 1}: ${message}`);
      console.log('🔄 Processing...');
      
      try {
        const response = await aiAgentService.processMessage(
          `test-user-${i}`,
          message,
          `test-session-${i}`
        );
        
        console.log('✅ Copil Response:');
        console.log(`Message: ${response.message}`);
        console.log(`Intent: ${response.intent}`);
        console.log(`Confidence: ${response.confidence}`);
        console.log(`Can Execute: ${response.canExecute}`);
        
        if (response.executionDetails) {
          console.log('Execution Details:', JSON.stringify(response.executionDetails, null, 2));
        }
        
        if (response.toolResults && response.toolResults.length > 0) {
          console.log('🔧 Tool Results:');
          response.toolResults.forEach((result, idx) => {
            console.log(`  Tool ${idx + 1}:`, result);
          });
        }
        
      } catch (error) {
        console.error(`❌ Error in test ${i + 1}:`, error.message);
      }
      
      console.log('\n' + '='.repeat(80));
    }
    
    // Test capabilities
    console.log('\n🎛️  Copil Capabilities:');
    const capabilities = aiAgentService.getCapabilities();
    console.log(JSON.stringify(capabilities, null, 2));
    
    console.log('\n🏥 Health Check:');
    const health = await aiAgentService.healthCheck();
    console.log(JSON.stringify(health, null, 2));
    
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run test
testCopilAgent().catch(console.error);
