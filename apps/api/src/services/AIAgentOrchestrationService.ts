import { logger } from '@/utils/logger';
import { PrismaClient } from '@prisma/client';
import { DEXAggregationServiceLike } from './DEXAggregationService';
import { StrategyExecutionEngine } from './StrategyExecutionEngine';
import OpenAIService from './OpenAIService';

export interface TradingIntent {
  action: 'buy' | 'sell' | 'swap' | 'provide_liquidity' | 'yield_farm' | 'portfolio_rebalance';
  tokenIn?: string;
  tokenOut?: string;
  amount?: string;
  slippage?: number;
  conditions?: TradingCondition[];
  timeline?: 'immediate' | 'scheduled' | 'conditional';
  riskLevel?: 'low' | 'medium' | 'high';
  maxGasPrice?: string;
}

export interface TradingCondition {
  type: 'price_above' | 'price_below' | 'time_after' | 'time_before' | 'market_cap_above' | 'volume_above';
  value: string;
  token?: string;
}

export interface AgentResponse {
  understanding: {
    intent: TradingIntent;
    confidence: number;
    parameters: Record<string, any>;
  };
  recommendations: {
    strategy: string;
    reasoning: string;
    alternatives: string[];
    risks: string[];
  };
  execution: {
    canExecute: boolean;
    requirements: string[];
    estimatedCost: {
      gas: string;
      slippage: number;
      priceImpact: number;
    };
  };
}

export interface ChatContext {
  userId: string;
  sessionId: string;
  conversationHistory: ChatMessage[];
  currentIntent?: TradingIntent;
  portfolioContext?: {
    totalValue: string;
    positions: Array<{
      token: string;
      balance: string;
      value: string;
    }>;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class AIAgentOrchestrationService {
  private prisma: PrismaClient;
  private dexService: DEXAggregationServiceLike;
  private strategyEngine: StrategyExecutionEngine;
  private openaiService: OpenAIService;
  private chatSessions: Map<string, ChatContext> = new Map();

  constructor(
    prisma: PrismaClient,
    dexService: DEXAggregationServiceLike,
    strategyEngine: StrategyExecutionEngine
  ) {
    this.prisma = prisma;
    this.dexService = dexService;
    this.strategyEngine = strategyEngine;
    this.openaiService = new OpenAIService();
    logger.info('🤖 AI Agent Orchestration Service initialized');
  }

  /**
   * Process user message and generate AI response
   */
  async processUserMessage(
    userId: string,
    message: string,
    sessionId: string = 'default'
  ): Promise<AgentResponse> {
    try {
      // Get or create chat context
      const context = await this.getChatContext(userId, sessionId);
      
      // Add user message to history
      context.conversationHistory.push({
        role: 'user',
        content: message,
        timestamp: new Date()
      });

      // Extract trading intent from message
      const intent = await this.extractTradingIntent(message, context);
      
      // Update context with new intent
      context.currentIntent = intent;

      // Generate recommendations
      const recommendations = await this.generateRecommendations(intent, context);

      // Assess execution feasibility
      const execution = await this.assessExecution(intent, context);

      const response: AgentResponse = {
        understanding: {
          intent,
          confidence: this.calculateConfidence(intent, message),
          parameters: this.extractParameters(message)
        },
        recommendations,
        execution
      };

      // Generate conversational response using OpenAI
      const conversationalResponse = await this.generateConversationalResponse(context, intent, response);
      
      // Add assistant response to history
      context.conversationHistory.push({
        role: 'assistant',
        content: conversationalResponse,
        timestamp: new Date(),
        metadata: { intent, recommendations, response }
      });

      // Save to database
      await this.saveChatMessage(userId, 'user', message, { intent });
      await this.saveChatMessage(userId, 'assistant', this.formatResponse(response), { response });

      // Update session
      this.chatSessions.set(`${userId}_${sessionId}`, context);

      return response;
    } catch (error) {
      logger.error('Error processing user message:', error);
      throw error;
    }
  }

  /**
   * Extract trading intent from natural language using OpenAI
   */
  private async extractTradingIntent(message: string, context: ChatContext): Promise<TradingIntent> {
    try {
      // Use OpenAI service for intelligent intent extraction
      const result = await this.openaiService.extractTradingIntent(message, {
        portfolio: context.portfolioContext,
        history: context.conversationHistory.slice(-5) // Last 5 messages for context
      });

      return result.intent;
    } catch (error) {
      logger.error('Error extracting intent with OpenAI, falling back to keyword detection:', error);
      
      // Fallback to simple keyword-based detection
      return this.fallbackIntentExtraction(message);
    }
  }

  /**
   * Fallback intent extraction using simple keyword matching
   */
  private fallbackIntentExtraction(message: string): TradingIntent {
    const lowerMessage = message.toLowerCase();
    const intent: TradingIntent = {
      action: 'swap',
      slippage: 0.5,
      timeline: 'immediate',
      riskLevel: 'medium'
    };

    // Action detection
    if (lowerMessage.includes('buy') || lowerMessage.includes('purchase')) {
      intent.action = 'buy';
    } else if (lowerMessage.includes('sell')) {
      intent.action = 'sell';
    } else if (lowerMessage.includes('swap') || lowerMessage.includes('trade') || lowerMessage.includes('exchange')) {
      intent.action = 'swap';
    } else if (lowerMessage.includes('liquidity') || lowerMessage.includes('pool')) {
      intent.action = 'provide_liquidity';
    } else if (lowerMessage.includes('yield') || lowerMessage.includes('farm') || lowerMessage.includes('stake')) {
      intent.action = 'yield_farm';
    } else if (lowerMessage.includes('rebalance') || lowerMessage.includes('portfolio')) {
      intent.action = 'portfolio_rebalance';
    }

    // Token detection
    const supportedTokens = this.dexService.getSupportedTokens();
    for (const token of supportedTokens) {
      if (lowerMessage.includes(token.symbol.toLowerCase()) || lowerMessage.includes(token.name.toLowerCase())) {
        if (!intent.tokenIn && (lowerMessage.includes('from') || lowerMessage.includes('sell'))) {
          intent.tokenIn = token.address;
        } else if (!intent.tokenOut && (lowerMessage.includes('to') || lowerMessage.includes('for') || lowerMessage.includes('buy'))) {
          intent.tokenOut = token.address;
        }
      }
    }

    // Amount detection
    const amountMatch = lowerMessage.match(/(\d+(?:\.\d+)?)\s*(sei|usdc|weth|wsei)/i);
    if (amountMatch) {
      const amount = parseFloat(amountMatch[1]);
      const token = amountMatch[2].toUpperCase();
      const tokenInfo = this.dexService.getTokenInfo(token);
      if (tokenInfo) {
        intent.amount = (amount * Math.pow(10, tokenInfo.decimals)).toString();
      }
    }

    // Timeline detection
    if (lowerMessage.includes('now') || lowerMessage.includes('immediate')) {
      intent.timeline = 'immediate';
    } else if (lowerMessage.includes('when') || lowerMessage.includes('if') || lowerMessage.includes('condition')) {
      intent.timeline = 'conditional';
    } else if (lowerMessage.includes('schedule') || lowerMessage.includes('later')) {
      intent.timeline = 'scheduled';
    }

    // Risk level detection
    if (lowerMessage.includes('safe') || lowerMessage.includes('conservative') || lowerMessage.includes('low risk')) {
      intent.riskLevel = 'low';
      intent.slippage = 0.3;
    } else if (lowerMessage.includes('aggressive') || lowerMessage.includes('high risk') || lowerMessage.includes('risky')) {
      intent.riskLevel = 'high';
      intent.slippage = 1.0;
    }

    // Condition extraction
    intent.conditions = this.extractConditions(message);

    return intent;
  }

  /**
   * Extract trading conditions from message
   */
  private extractConditions(message: string): TradingCondition[] {
    const conditions: TradingCondition[] = [];
    const lowerMessage = message.toLowerCase();

    // Price conditions
    const priceAboveMatch = lowerMessage.match(/when.*price.*above.*?(\d+(?:\.\d+)?)/);
    if (priceAboveMatch) {
      conditions.push({
        type: 'price_above',
        value: priceAboveMatch[1]
      });
    }

    const priceBelowMatch = lowerMessage.match(/when.*price.*below.*?(\d+(?:\.\d+)?)/);
    if (priceBelowMatch) {
      conditions.push({
        type: 'price_below',
        value: priceBelowMatch[1]
      });
    }

    // Time conditions
    const timeMatch = lowerMessage.match(/at (\d{1,2}:\d{2})|in (\d+) (minutes?|hours?|days?)/);
    if (timeMatch) {
      let targetTime: Date;
      
      if (timeMatch[1]) { // Specific time today
        const [hours, minutes] = timeMatch[1].split(':');
        targetTime = new Date();
        targetTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        if (targetTime < new Date()) {
          targetTime.setDate(targetTime.getDate() + 1);
        }
      } else { // Relative time
        const amount = parseInt(timeMatch[2]);
        const unit = timeMatch[3];
        targetTime = new Date();
        
        if (unit.startsWith('minute')) {
          targetTime.setMinutes(targetTime.getMinutes() + amount);
        } else if (unit.startsWith('hour')) {
          targetTime.setHours(targetTime.getHours() + amount);
        } else if (unit.startsWith('day')) {
          targetTime.setDate(targetTime.getDate() + amount);
        }
      }

      conditions.push({
        type: 'time_after',
        value: targetTime.toISOString()
      });
    }

    return conditions;
  }

  /**
   * Generate trading recommendations
   */
  private async generateRecommendations(intent: TradingIntent, context: ChatContext): Promise<AgentResponse['recommendations']> {
    const recommendations = {
      strategy: '',
      reasoning: '',
      alternatives: [] as string[],
      risks: [] as string[]
    };

    const dexStatus = this.getDexServiceStatus();

    switch (intent.action) {
      case 'swap':
        if (intent.tokenIn && intent.tokenOut && intent.amount) {
          if (!dexStatus.ready) {
            recommendations.strategy = 'Awaiting DEX connectivity';
            recommendations.reasoning = dexStatus.reason ?? 'DEX aggregation service is currently unavailable.';
            recommendations.risks = ['Cannot evaluate market quotes until DEX connectivity is restored'];
            recommendations.alternatives = ['Retry once the DEX service is healthy'];
            break;
          }

          try {
            const quote = await this.dexService.getBestQuote({
              tokenIn: intent.tokenIn,
              tokenOut: intent.tokenOut,
              amountIn: intent.amount,
              slippage: intent.slippage || 0.5,
              recipient: '0x0000000000000000000000000000000000000000' // Placeholder
            });
            
            recommendations.strategy = `Execute swap on ${quote.bestQuote.dexName}`;
            recommendations.reasoning = `${quote.bestQuote.dexName} offers the best rate with ${quote.bestQuote.amountOutFormatted} output tokens, saving ${quote.savings.percentage.toFixed(2)}% compared to other DEXs.`;
            recommendations.alternatives = quote.allQuotes.slice(1).map(q => 
              `Use ${q.dexName} (${q.amountOutFormatted} output, ${q.gasEstimate} gas)`
            );
            recommendations.risks = [
              `Price impact: ${quote.bestQuote.priceImpact}%`,
              `Slippage tolerance: ${intent.slippage}%`,
              `Gas cost: ${quote.bestQuote.gasEstimate} units`
            ];
          } catch (error) {
            recommendations.strategy = 'Unable to execute swap';
            recommendations.reasoning = 'Could not get quotes from DEXs';
            recommendations.risks = ['Pair may not be supported', 'Insufficient liquidity'];
          }
        } else {
          recommendations.strategy = 'Incomplete swap parameters';
          recommendations.reasoning = 'Need tokenIn, tokenOut, and amount to proceed';
          recommendations.alternatives = ['Specify missing parameters'];
        }
        break;

      case 'buy':
        recommendations.strategy = 'Market buy order';
        recommendations.reasoning = `Execute immediate purchase using DEX aggregation for best price`;
        recommendations.alternatives = [
          'Set limit order at target price',
          'Dollar-cost average over time',
          'Wait for better market conditions'
        ];
        recommendations.risks = [
          'Market volatility during execution',
          'Price impact for large orders',
          'Gas fees during high network congestion'
        ];
        break;

      case 'yield_farm':
        recommendations.strategy = 'Automated yield optimization';
        recommendations.reasoning = `Monitor yield opportunities and automatically move funds to highest APY pools`;
        recommendations.alternatives = [
          'Single pool staking',
          'Manual yield farming',
          'Stable coin farming for lower risk'
        ];
        recommendations.risks = [
          'Smart contract risk',
          'Impermanent loss',
          'Yield rate fluctuations',
          'Platform governance changes'
        ];
        break;

      default:
        recommendations.strategy = 'Review and clarify intent';
        recommendations.reasoning = 'Need more specific instructions to provide accurate recommendations';
        recommendations.alternatives = ['Provide more details about desired action'];
    }

    return recommendations;
  }

  /**
   * Assess execution feasibility
   */
  private async assessExecution(intent: TradingIntent, context: ChatContext): Promise<AgentResponse['execution']> {
    const execution = {
      canExecute: false,
      requirements: [] as string[],
      estimatedCost: {
        gas: '0',
        slippage: intent.slippage || 0.5,
        priceImpact: 0
      }
    };

    // Check basic requirements
    if (!intent.tokenIn || !intent.tokenOut) {
      execution.requirements.push('Specify both input and output tokens');
    }

    if (!intent.amount) {
      execution.requirements.push('Specify trade amount');
    }

    // Check DEX support
    if (intent.tokenIn && intent.tokenOut) {
      const dexStatus = this.getDexServiceStatus();

      if (!dexStatus.ready) {
        execution.requirements.push(dexStatus.reason ?? 'DEX aggregation unavailable');
        return execution;
      }

      const isSupported = await this.dexService.isPairSupported(intent.tokenIn, intent.tokenOut);
      if (!isSupported) {
        execution.requirements.push('Trading pair not supported on available DEXs');
      }

      // Estimate costs if possible
      if (intent.amount) {
        try {
          const quote = await this.dexService.getBestQuote({
            tokenIn: intent.tokenIn,
            tokenOut: intent.tokenOut,
            amountIn: intent.amount,
            slippage: intent.slippage || 0.5,
            recipient: '0x0000000000000000000000000000000000000000'
          });

          execution.estimatedCost = {
            gas: quote.bestQuote.gasEstimate,
            slippage: quote.bestQuote.slippage,
            priceImpact: quote.bestQuote.priceImpact
          };

          if (execution.requirements.length === 0) {
            execution.canExecute = true;
          }
        } catch (error) {
          execution.requirements.push('Unable to get price quote');
        }
      }
    }

    return execution;
  }

  /**
   * Calculate confidence score for intent extraction
   */
  private calculateConfidence(intent: TradingIntent, message: string): number {
    let confidence = 0.5; // Base confidence

    // Action clarity
    const actionWords = ['buy', 'sell', 'swap', 'trade', 'exchange', 'liquidity', 'yield', 'farm'];
    const hasActionWord = actionWords.some(word => message.toLowerCase().includes(word));
    if (hasActionWord) confidence += 0.2;

    // Token specification
    if (intent.tokenIn || intent.tokenOut) confidence += 0.2;

    // Amount specification
    if (intent.amount) confidence += 0.1;

    // Conditions
    if (intent.conditions && intent.conditions.length > 0) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Extract parameters from message
   */
  private extractParameters(message: string): Record<string, any> {
    const params: Record<string, any> = {};
    
    // Extract numbers
    const numbers = message.match(/\d+(?:\.\d+)?/g);
    if (numbers) {
      params.numbers = numbers.map(n => parseFloat(n));
    }

    // Extract time references
    const timeRefs = message.match(/(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2})/gi);
    if (timeRefs) {
      params.timeReferences = timeRefs;
    }

    return params;
  }

  /**
   * Format response for chat
   */
  private formatResponse(response: AgentResponse): string {
    let formatted = `I understand you want to ${response.understanding.intent.action}`;
    
    if (response.understanding.intent.tokenIn || response.understanding.intent.tokenOut) {
      const tokenInInfo = response.understanding.intent.tokenIn ? 
        this.dexService.getTokenInfo(response.understanding.intent.tokenIn) : null;
      const tokenOutInfo = response.understanding.intent.tokenOut ? 
        this.dexService.getTokenInfo(response.understanding.intent.tokenOut) : null;
        
      if (tokenInInfo && tokenOutInfo) {
        formatted += ` ${tokenInInfo.symbol} for ${tokenOutInfo.symbol}`;
      }
    }

    formatted += `.\n\n**Recommendation:** ${response.recommendations.strategy}\n`;
    formatted += `**Reasoning:** ${response.recommendations.reasoning}\n`;

    if (response.execution.canExecute) {
      formatted += `\n✅ This trade can be executed`;
      formatted += `\n**Estimated gas:** ${response.execution.estimatedCost.gas}`;
      formatted += `\n**Price impact:** ${response.execution.estimatedCost.priceImpact}%`;
    } else {
      formatted += `\n❌ Cannot execute yet`;
      formatted += `\n**Requirements:** ${response.execution.requirements.join(', ')}`;
    }

    if (response.recommendations.risks.length > 0) {
      formatted += `\n\n**Risks to consider:** ${response.recommendations.risks.join(', ')}`;
    }

    return formatted;
  }

  private getDexServiceStatus(): { ready: boolean; reason?: string } {
    return this.dexService.getStatus();
  }

  /**
   * Get or create chat context
   */
  private async getChatContext(userId: string, sessionId: string): Promise<ChatContext> {
    const contextKey = `${userId}_${sessionId}`;
    
    if (this.chatSessions.has(contextKey)) {
      return this.chatSessions.get(contextKey)!;
    }

    // Load recent history from database - no ChatMessage model in current schema
    // const recentMessages = await this.prisma.chatMessage.findMany({
    //   where: { userId },
    //   orderBy: { createdAt: 'desc' },
    //   take: 20
    // });

    const recentMessages: any[] = []; // Empty for now until we add ChatMessage model

    const context: ChatContext = {
      userId,
      sessionId,
      conversationHistory: recentMessages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: msg.createdAt,
        metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined
      })).reverse()
    };

    this.chatSessions.set(contextKey, context);
    return context;
  }

  /**
   * Save chat message to database
   */
  private async saveChatMessage(
    userId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: any
  ): Promise<void> {
    try {
      // For now, just log the message since ChatMessage model is not in current schema
      logger.debug(`Chat message from ${userId} (${role}): ${content.substring(0, 100)}...`);
      
      // TODO: Uncomment when ChatMessage model is added to schema
      // await this.prisma.chatMessage.create({
      //   data: {
      //     userId,
      //     role: role.toUpperCase() as any,
      //     content,
      //     metadata: metadata ? JSON.stringify(metadata) : '{}'
      //   }
      // });
    } catch (error) {
      logger.error('Failed to save chat message:', error);
    }
  }

  /**
   * Get chat history for user
   */
  async getChatHistory(userId: string, limit: number = 50): Promise<ChatMessage[]> {
    // For now, return from session cache until ChatMessage model is added
    const contextKey = `${userId}_default`;
    const context = this.chatSessions.get(contextKey);
    
    if (context) {
      return context.conversationHistory.slice(-limit);
    }
    
    return [];
    
    // TODO: Uncomment when ChatMessage model is added to schema
    // const messages = await this.prisma.chatMessage.findMany({
    //   where: { userId },
    //   orderBy: { createdAt: 'desc' },
    //   take: limit
    // });

    // return messages.map(msg => ({
    //   role: msg.role.toLowerCase() as 'user' | 'assistant' | 'system',
    //   content: msg.content,
    //   timestamp: msg.createdAt,
    //   metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined
    // })).reverse();
  }

  /**
   * Generate conversational response using OpenAI
   */
  private async generateConversationalResponse(
    context: ChatContext,
    intent: TradingIntent,
    response: AgentResponse
  ): Promise<string> {
    try {
      // Convert chat history to OpenAI format
      const messages = context.conversationHistory.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      }));

      // Generate response with context
      const conversationalResponse = await this.openaiService.generateResponse(
        messages,
        intent,
        {
          portfolio: context.portfolioContext,
          recommendations: response.recommendations,
          execution: response.execution,
          confidence: response.understanding.confidence
        }
      );

      return conversationalResponse;
    } catch (error) {
      logger.error('Error generating conversational response:', error);
      // Fallback to basic formatting
      return this.formatResponse(response);
    }
  }

  /**
   * Clear chat session
   */
  clearChatSession(userId: string, sessionId: string = 'default'): void {
    const contextKey = `${userId}_${sessionId}`;
    this.chatSessions.delete(contextKey);
  }
}

export default AIAgentOrchestrationService;
