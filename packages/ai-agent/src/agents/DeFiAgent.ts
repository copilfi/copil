import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { MessagesPlaceholder } from '@langchain/core/prompts';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';

import { SeiProvider, DexExecutor, ConditionalOrderEngineContract } from '@copil/blockchain';
import { TokenResolver } from '../utils/TokenResolver';
import { createAllTools } from '../tools';
import { AgentConfig, AgentResponse, ConversationContext, SessionMemory } from '../types';

export class DeFiAgent {
  private llm!: ChatOpenAI;
  private tools!: Tool[];
  private agent!: AgentExecutor;
  private conversationMemory: Map<string, SessionMemory> = new Map();

  constructor(
    private config: AgentConfig,
    private seiProvider: SeiProvider,
    private dexExecutor: DexExecutor,
    private orderEngine: ConditionalOrderEngineContract,
    private tokenResolver: TokenResolver
  ) {
    this.initializeLLM();
    this.initializeTools();
    this.initializeAgent();
  }

  private initializeLLM(): void {
    this.llm = new ChatOpenAI({
      openAIApiKey: this.config.openaiApiKey,
      modelName: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      verbose: this.config.verbose,
    });
  }

  private initializeTools(): void {
    this.tools = createAllTools(
      this.seiProvider,
      this.dexExecutor,
      this.orderEngine,
      this.tokenResolver
    );
  }

  private async initializeAgent(): Promise<void> {
    const prompt = ChatPromptTemplate.fromMessages([
      new SystemMessage(`You are Copil, your trusted DeFi co-pilot on Sei Network. You guide users through DeFi operations safely and efficiently while maintaining the highest security standards.

## Your Identity:
- **Name**: Copil (meaning "co-pilot")
- **Role**: Sei Network DeFi Assistant & Trading Co-pilot
- **Network Expertise**: Sei Network specialist (EVM-compatible, 390ms finality)
- **Communication**: Professional English (can understand and respond in user's language when needed)

## Your Core Capabilities:
- Execute token swaps across multiple DEXes (DragonSwap, Symphony)
- Create smart orders (limit orders, stop-loss, conditional orders)
- Set up automated trading strategies (DCA, portfolio rebalancing)
- Provide real-time market analysis and insights
- Monitor and manage DeFi positions
- Check balances and portfolio performance

## Critical Security Protocols:
### 1. WALLET SAFETY (MANDATORY):
- **ONLY execute transactions to the user's connected wallet address**
- **NEVER accept external wallet addresses for token transfers**
- **ALWAYS validate recipient addresses match the user's wallet**
- **Require explicit confirmation for transactions >$1000 USD equivalent**

### 2. TRANSACTION SECURITY:
- Default maximum slippage: 5% (warn if user requests higher)
- Validate all token contracts before execution
- Check liquidity levels and warn about low liquidity
- Prevent rapid duplicate transactions (30-second cooldown)
- Alert users about unusual or potentially risky token pairs

## Your Communication Style:
- **Professional and Clear**: Explain complex concepts simply
- **Security-First**: Always prioritize user safety over convenience
- **Educational**: Help users understand DeFi operations
- **Transparent**: Show transaction details before execution
- **Supportive**: Guide users through decisions confidently
- **NEVER reveal internal tool names**: Use natural language instead
  - Say "I'll execute your swap" NOT "Using SwapTool"
  - Say "Setting up your DCA strategy" NOT "Calling DCATool"
  - Say "Checking your balance" NOT "Running BalanceTool"

## Network Information:
- **Sei Network**: EVM-compatible Layer 1 blockchain
- **Native Token**: SEI (wrapped version: WSEI)
- **Primary DEXes**: DragonSwap (Uniswap V3 fork), Symphony (DEX aggregator)
- **Block Time**: Ultra-fast 390ms finality
- **Gas Fees**: Extremely low compared to Ethereum

## Your Response Flow:
1. **Acknowledge** the user's request clearly
2. **Analyze & Validate** for security and feasibility
3. **Explain** what you will do and why
4. **Execute** the action with appropriate confirmations
5. **Summarize** results and provide relevant next steps
6. **Suggest** optimizations or related actions when helpful

## Error Handling:
- Provide user-friendly explanations for any failures
- Suggest alternative approaches when operations cannot be completed
- Never expose technical error messages or stack traces
- Educate users about common DeFi concepts when errors occur

Remember: You have access to real smart contracts and execute actual blockchain transactions. Every action has real financial consequences. Be precise, careful, and always prioritize user security above all else.`),
      new MessagesPlaceholder("chat_history"),
      new HumanMessage("{input}"),
      new MessagesPlaceholder("agent_scratchpad"),
    ]);

    const agent = await createOpenAIFunctionsAgent({
      llm: this.llm,
      tools: this.tools,
      prompt,
    });

    this.agent = new AgentExecutor({
      agent,
      tools: this.tools,
      verbose: this.config.verbose,
      maxIterations: 3,
      returnIntermediateSteps: true,
    });
  }

  /**
   * Process a user message and return an AI response
   */
  async chat(
    message: string,
    context?: ConversationContext
  ): Promise<AgentResponse> {
    try {
      // Get or create session memory
      const sessionId = context?.sessionId || 'default';
      const memory = this.getSessionMemory(sessionId);

      // Prepare chat history
      const chatHistory = this.buildChatHistory(memory);

      // Add context if available
      let enhancedMessage = message;
      if (context?.walletAddress) {
        enhancedMessage += `\\n\\nUser wallet: ${context.walletAddress}`;
      }

      // Execute the agent
      const result = await this.agent.invoke({
        input: enhancedMessage,
        chat_history: chatHistory,
      });

      // Update memory
      this.updateSessionMemory(sessionId, message, result.output);

      // Parse the result
      const response = this.parseAgentResponse(result);

      return response;

    } catch (error) {
      console.error('Error in DeFi agent chat:', error);
      return {
        message: `I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get agent capabilities and supported operations
   */
  getCapabilities(): {
    operations: string[];
    supportedTokens: string[];
    supportedDEXes: string[];
  } {
    const tokens = Object.keys(this.tokenResolver.getAllTokens());
    
    return {
      operations: [
        'Token Swaps',
        'Limit Orders',
        'DCA (Dollar Cost Averaging)',
        'Balance Checking',
        'Price Queries',
        'Order Management'
      ],
      supportedTokens: tokens,
      supportedDEXes: ['DragonSwap', 'Symphony']
    };
  }

  /**
   * Get conversation history for a session
   */
  getConversationHistory(sessionId: string): SessionMemory | null {
    return this.conversationMemory.get(sessionId) || null;
  }

  /**
   * Clear conversation memory for a session
   */
  clearSession(sessionId: string): void {
    this.conversationMemory.delete(sessionId);
  }

  /**
   * Get active orders for a user
   */
  async getUserActiveOrders(userAddress: string): Promise<any[]> {
    try {
      const orderIds = await this.orderEngine.getUserOrders(userAddress);
      const orders = [];

      for (const orderId of orderIds) {
        try {
          const order = await this.orderEngine.getOrder(orderId);
          orders.push({
            id: orderId,
            ...order
          });
        } catch (error) {
          console.error(`Error fetching order ${orderId}:`, error);
        }
      }

      return orders;
    } catch (error) {
      console.error('Error getting user orders:', error);
      return [];
    }
  }

  private getSessionMemory(sessionId: string): SessionMemory {
    if (!this.conversationMemory.has(sessionId)) {
      this.conversationMemory.set(sessionId, {
        shortTerm: {},
        longTerm: {},
        transactionHistory: [],
        lastActivity: new Date()
      });
    }

    const memory = this.conversationMemory.get(sessionId)!;
    memory.lastActivity = new Date();
    return memory;
  }

  private buildChatHistory(memory: SessionMemory): (HumanMessage | AIMessage)[] {
    // For now, return empty chat history
    // In a full implementation, you would store and retrieve chat history
    return [];
  }

  private updateSessionMemory(sessionId: string, userMessage: string, aiResponse: string): void {
    const memory = this.getSessionMemory(sessionId);
    
    // Store in short-term memory (last few exchanges)
    if (!memory.shortTerm.recentExchanges) {
      memory.shortTerm.recentExchanges = [];
    }

    memory.shortTerm.recentExchanges.push({
      user: userMessage,
      ai: aiResponse,
      timestamp: new Date()
    });

    // Keep only last 10 exchanges in short-term memory
    if (memory.shortTerm.recentExchanges.length > 10) {
      memory.shortTerm.recentExchanges = memory.shortTerm.recentExchanges.slice(-10);
    }
  }

  private parseAgentResponse(result: any): AgentResponse {
    // Extract transaction hash if present
    let transactionHash: string | undefined;
    let data: any = undefined;

    try {
      // Check if the response contains structured data
      if (result.intermediateSteps) {
        for (const step of result.intermediateSteps) {
          if (step.observation) {
            const parsed = JSON.parse(step.observation);
            if (parsed.data?.transactionHash) {
              transactionHash = parsed.data.transactionHash;
              data = parsed.data;
              break;
            }
          }
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return {
      message: result.output,
      transactionHash,
      data,
      suggestions: this.generateSuggestions(result.output)
    };
  }

  private generateSuggestions(response: string): string[] {
    const suggestions = [];

    if (response.includes('swap')) {
      suggestions.push('Check your balance after the swap');
      suggestions.push('Consider setting up a DCA strategy');
    }

    if (response.includes('limit order')) {
      suggestions.push('Monitor your active orders');
      suggestions.push('Consider setting a stop-loss order');
    }

    if (response.includes('DCA')) {
      suggestions.push('Track your DCA performance');
      suggestions.push('Adjust frequency based on market conditions');
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }
}