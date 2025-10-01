import { logger } from '@/utils/logger';
import { PrismaClient } from '@prisma/client';
import { DeFiAgent, AgentConfig, ConversationContext } from '@copil/ai-agent';
import { createAllTools } from '@copil/ai-agent';
import { SeiProvider, DexExecutor, ConditionalOrderEngineContract } from '@copil/blockchain';
import { TokenResolver } from '@copil/ai-agent';
import env from '@/config/env';

export interface ChatResponse {
  message: string;
  intent?: any;
  confidence: number;
  canExecute: boolean;
  executionDetails?: any;
  toolResults?: any[];
}

export class AIAgentService {
  private defiAgent!: DeFiAgent;
  private seiProvider!: SeiProvider;
  private dexExecutor!: DexExecutor;
  private orderEngine!: ConditionalOrderEngineContract;
  private tokenResolver!: TokenResolver;
  private initialized = false;

  constructor(private prisma: PrismaClient) {
    logger.info('🤖 AI Agent Service initialized');
  }

  /**
   * Initialize AI Agent with blockchain services
   */
  async initialize(): Promise<void> {
    try {
      // Initialize blockchain providers
      this.seiProvider = new SeiProvider({
        rpcUrl: env.NODE_ENV === 'production' ? env.SEI_MAINNET_RPC_URL : env.SEI_TESTNET_RPC_URL,
        chainId: env.NODE_ENV === 'production' ? 1329 : 1328, // Sei Pacific mainnet : testnet
        name: 'Sei Network',
        blockExplorer: 'https://seitrace.com',
        nativeCurrency: {
          symbol: 'SEI',
          name: 'Sei',
          decimals: 18
        },
        contracts: {
          entryPoint: env.ENTRY_POINT_ADDRESS || '0x0000000000000000000000000000000000000000',
          conditionalOrderEngine: env.CONDITIONAL_ORDER_ENGINE_ADDRESS || '0x0000000000000000000000000000000000000000'
        }
      }, env.PRIVATE_KEY);

      // Initialize DEX executor
      this.dexExecutor = new DexExecutor(
        this.seiProvider,
        new ConditionalOrderEngineContract(
          this.seiProvider,
          env.CONDITIONAL_ORDER_ENGINE_ADDRESS || '0x0000000000000000000000000000000000000000'
        )
      );

      // Initialize conditional order engine
      this.orderEngine = new ConditionalOrderEngineContract(
        this.seiProvider,
        env.CONDITIONAL_ORDER_ENGINE_ADDRESS || '0x0000000000000000000000000000000000000000'
      );

      // Initialize token resolver
      this.tokenResolver = new TokenResolver();

      // Configure AI Agent
      const agentConfig: AgentConfig = {
        openaiApiKey: env.OPENAI_API_KEY || '',
        model: 'gpt-4',
        temperature: 0.3,
        maxTokens: 1000,
        verbose: env.NODE_ENV === 'development'
      };

      // Initialize DeFi Agent with tools
      this.defiAgent = new DeFiAgent(
        agentConfig,
        this.seiProvider,
        this.dexExecutor,
        this.orderEngine,
        this.tokenResolver
      );

      this.initialized = true;
      logger.info('✅ AI Agent Service fully initialized with blockchain integration');

    } catch (error) {
      logger.error('❌ Failed to initialize AI Agent Service:', error);
      throw error;
    }
  }

  /**
   * Process user message using the DeFi Agent
   */
  async processMessage(
    userId: string, 
    message: string, 
    sessionId: string = 'default'
  ): Promise<ChatResponse> {
    if (!this.initialized) {
      throw new Error('AI Agent Service not initialized');
    }

    try {
      logger.info(`Processing message for user ${userId}: ${message.substring(0, 50)}...`);

      // Get user context (portfolio, transaction history, etc.)
      const userContext = await this.getUserContext(userId);

      // Build conversation context for the agent
      const context: ConversationContext = {
        userId,
        sessionId,
        walletAddress: userContext.walletAddress,
        preferences: userContext.preferences
      };

      // Process with DeFi Agent
      const agentResponse = await this.defiAgent.chat(message, context);

      // Convert AgentResponse to ChatResponse format
      const response: ChatResponse = {
        message: agentResponse.message || 'I processed your request.',
        intent: agentResponse.action || 'unknown',
        confidence: agentResponse.confidence || 0.5,
        canExecute: agentResponse.success || false,
        executionDetails: agentResponse.data,
        toolResults: agentResponse.toolResults
      };

      // Log conversation for analytics
      await this.logConversation(userId, message, response, sessionId);

      logger.info(`AI Agent response generated for user ${userId} with confidence ${response.confidence}`);
      
      return response;

    } catch (error) {
      logger.error('Error processing message with AI Agent:', error);
      
      // Fallback response
      return {
        message: "I'm having trouble processing your request right now. Please try rephrasing or try again later.",
        confidence: 0,
        canExecute: false
      };
    }
  }

  /**
   * Get user context for better AI responses
   */
  private async getUserContext(userId: string): Promise<any> {
    try {
      // Get user's portfolio information
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          strategies: {
            where: { isActive: true },
            take: 5,
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!user) {
        return { portfolio: [], strategies: [] };
      }

      // Get recent transactions for context
      const recentTransactions = await this.prisma.transaction.findMany({
        where: { userId },
        take: 10,
        orderBy: { executedAt: 'desc' }
      });

      return {
        walletAddress: user.walletAddress,
        strategies: user.strategies,
        recentTransactions,
        preferences: {
          riskLevel: 'medium', // Could be stored in user profile
          defaultSlippage: 0.5
        }
      };

    } catch (error) {
      logger.error('Error getting user context:', error);
      return { portfolio: [], strategies: [] };
    }
  }

  /**
   * Log conversation for analytics and debugging
   */
  private async logConversation(
    userId: string,
    userMessage: string,
    agentResponse: ChatResponse,
    sessionId: string
  ): Promise<void> {
    try {
      // For now, just log to console
      // In production, would store in database for analytics
      logger.debug('Conversation logged:', {
        userId,
        sessionId,
        userMessage: userMessage.substring(0, 100),
        intent: agentResponse.intent,
        confidence: agentResponse.confidence,
        timestamp: new Date()
      });

      // TODO: Implement proper conversation logging when ChatMessage model is added
      
    } catch (error) {
      logger.error('Failed to log conversation:', error);
      // Don't throw - this shouldn't break the main flow
    }
  }

  /**
   * Get chat history for a user
   */
  async getChatHistory(userId: string, limit: number = 20): Promise<any[]> {
    if (!this.initialized) {
      return [];
    }

    try {
      // For now, return empty array since we don't have persistent chat history yet
      // TODO: Implement chat history retrieval when ChatMessage model is added
      logger.debug(`Requested chat history for user ${userId}, limit ${limit}`);
      return [];
    } catch (error) {
      logger.error('Error getting chat history:', error);
      return [];
    }
  }

  /**
   * Clear chat session
   */
  clearChatSession(userId: string, sessionId: string = 'default'): void {
    if (!this.initialized) {
      return;
    }

    try {
      // For now, just log the action
      // TODO: Implement session clearing when memory management is implemented
      logger.info(`Cleared chat session for user ${userId}, session ${sessionId}`);
    } catch (error) {
      logger.error('Error clearing chat session:', error);
    }
  }

  /**
   * Get AI capabilities
   */
  getCapabilities(): any {
    return {
      supportedActions: [
        'swap',
        'limit_order',
        'dca',
        'balance_check',
        'portfolio_analysis'
      ],
      supportedTokens: this.getSupportedTokenSymbols(),
      supportedDEXs: ['dragonswap', 'symphony'],
      naturalLanguageFeatures: [
        'Intent extraction from conversational text',
        'Token recognition by symbol or name',
        'Amount parsing with unit detection',
        'Time and date parsing for scheduled orders',
        'Risk level assessment',
        'Condition extraction for limit orders',
        'Strategy recommendations'
      ],
      integrations: [
        'DEX aggregation for best prices',
        'Conditional order execution',
        'Real-time market data',
        'Portfolio management',
        'Risk assessment'
      ]
    };
  }

  private getSupportedTokenSymbols(): string[] {
    const resolver = this.tokenResolver ?? new TokenResolver();
    return Object.keys(resolver.getAllTokens());
  }

  /**
   * Health check for AI Agent Service
   */
  async healthCheck(): Promise<any> {
    return {
      status: this.initialized ? 'healthy' : 'initializing',
      services: {
        aiAgent: this.initialized,
        blockchainConnection: this.seiProvider ? true : false,
        dexIntegration: this.dexExecutor ? true : false,
        orderEngine: this.orderEngine ? true : false
      },
      capabilities: this.initialized ? Object.keys(this.getCapabilities()) : [],
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Execute a trading action directly (for API endpoints)
   */
  async executeTradingAction(
    userId: string,
    action: string,
    parameters: any
  ): Promise<any> {
    if (!this.initialized) {
      throw new Error('AI Agent Service not initialized');
    }

    try {
      logger.info(`Executing trading action ${action} for user ${userId}`);
      
      // Convert parameters to natural language prompt for the AI Agent
      const naturalLanguagePrompt = this.convertActionToPrompt(action, parameters);
      
      // Process through AI Agent for consistency
      const response = await this.processMessage(userId, naturalLanguagePrompt);
      
      return response;

    } catch (error) {
      logger.error('Error executing trading action:', error);
      throw error;
    }
  }

  /**
   * Convert structured action to natural language for AI processing
   */
  private convertActionToPrompt(action: string, parameters: any): string {
    switch (action) {
      case 'swap':
        return `Swap ${parameters.amount} ${parameters.tokenFrom} for ${parameters.tokenTo}`;
      case 'limit_order':
        return `Create a ${parameters.orderType} limit order for ${parameters.amount} ${parameters.tokenFrom} to ${parameters.tokenTo} at price ${parameters.targetPrice}`;
      case 'dca':
        return `Set up DCA to buy ${parameters.tokenTo} with ${parameters.totalBudget} ${parameters.tokenFrom} every ${parameters.frequency} for ${parameters.duration} days`;
      case 'balance':
        return parameters.token ? `Check my ${parameters.token} balance` : `Check my wallet balance`;
      default:
        return `Execute ${action} with parameters: ${JSON.stringify(parameters)}`;
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.initialized;
  }
}

export default AIAgentService;
