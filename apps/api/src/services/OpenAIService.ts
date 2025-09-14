import OpenAI from 'openai';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import { TradingIntent, TradingCondition } from './AIAgentOrchestrationService';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface IntentExtractionResponse {
  intent: TradingIntent;
  confidence: number;
  reasoning: string;
  suggestions?: string[];
}

export interface MarketAnalysisRequest {
  tokens: string[];
  timeframe: '1h' | '4h' | '1d' | '1w';
  context?: string;
}

export interface MarketAnalysisResponse {
  analysis: string;
  sentiment: 'bullish' | 'neutral' | 'bearish';
  confidence: number;
  keyFactors: string[];
  recommendations: string[];
}

export class OpenAIService {
  private openai: OpenAI;
  private model: string;

  constructor() {
    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'your_openai_api_key') {
      throw new Error('OpenAI API key is required. Please set OPENAI_API_KEY in .env file');
    }

    this.openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
    
    this.model = env.OPENAI_MODEL || 'gpt-4';
    logger.info(`🤖 OpenAI Service initialized with model: ${this.model}`);
  }

  /**
   * Extract trading intent from user message using GPT-4
   */
  async extractTradingIntent(message: string, context?: any): Promise<IntentExtractionResponse> {
    try {
      const systemPrompt = `You are a DeFi trading assistant specialized in Sei Network. Your job is to extract trading intents from user messages and convert them into structured data.

SUPPORTED ACTIONS: buy, sell, swap, provide_liquidity, yield_farm, portfolio_rebalance
SUPPORTED TOKENS ON SEI: SEI, USDC, USDT, WETH, WSEI
TIMELINES: immediate, scheduled, conditional
RISK LEVELS: low, medium, high

Extract the following information from user messages:
1. Trading action
2. Tokens involved (from/to)
3. Amount (if specified)
4. Conditions (price triggers, time-based)
5. Risk level preferences
6. Timeline (immediate, conditional, scheduled)

Return a JSON response with:
- intent: TradingIntent object
- confidence: 0-1 score
- reasoning: explanation of your analysis
- suggestions: helpful suggestions for unclear parts

Example user: "Swap 100 USDC for SEI when SEI hits $0.50"
Example response:
{
  "intent": {
    "action": "swap",
    "tokenIn": "USDC",
    "tokenOut": "SEI", 
    "amount": "100",
    "conditions": [{"type": "price_above", "value": "0.50", "token": "SEI"}],
    "timeline": "conditional",
    "riskLevel": "medium"
  },
  "confidence": 0.95,
  "reasoning": "Clear swap intent with specific amount and price condition",
  "suggestions": []
}`;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ];

      if (context) {
        messages.splice(1, 0, {
          role: 'system',
          content: `Additional context: ${JSON.stringify(context)}`
        });
      }

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 500
        // Removed response_format for compatibility with GPT-4
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI');
      }

      const result = JSON.parse(response) as IntentExtractionResponse;
      
      logger.info(`✅ Intent extracted with confidence: ${result.confidence}`);
      return result;

    } catch (error) {
      logger.error('❌ Error extracting trading intent:', error);
      // Fallback to basic intent with low confidence
      return {
        intent: {
          action: 'swap',
          timeline: 'immediate',
          riskLevel: 'medium'
        },
        confidence: 0.1,
        reasoning: 'Failed to extract intent using AI, returning default',
        suggestions: ['Please rephrase your request more clearly']
      };
    }
  }

  /**
   * Generate conversational response for user
   */
  async generateResponse(
    messages: ChatMessage[],
    intent?: TradingIntent,
    marketData?: any
  ): Promise<string> {
    try {
      const systemPrompt = `You are an expert DeFi trading assistant for Sei Network. You help users with:
- Token swaps and trading strategies
- Portfolio management and rebalancing  
- Yield farming and liquidity provision
- Market analysis and recommendations
- Risk management and safety

Key traits:
- Professional but friendly tone
- Always prioritize user safety and risk management
- Provide clear explanations for recommendations
- Ask clarifying questions when needed
- Mention relevant risks and considerations

Available DEXs on Sei: Astroport, DragonSwap, White Whale
Native tokens: SEI, USDC, USDT, WETH, WSEI

If you understand a trading intent, acknowledge it and provide:
1. Summary of what you understood
2. Current market conditions (if available)
3. Recommendations or next steps
4. Risk considerations
5. Ask for confirmation before executing`;

      const contextualMessages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];

      // Add intent and market data context if available
      if (intent || marketData) {
        const contextInfo = [];
        if (intent) contextInfo.push(`Detected intent: ${JSON.stringify(intent)}`);
        if (marketData) contextInfo.push(`Market data: ${JSON.stringify(marketData)}`);
        
        contextualMessages.push({
          role: 'system',
          content: `Context: ${contextInfo.join('; ')}`
        });
      }

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: contextualMessages,
        temperature: 0.7,
        max_tokens: 800
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI');
      }

      return response;

    } catch (error) {
      logger.error('❌ Error generating response:', error);
      return "I'm sorry, I'm having trouble processing your request right now. Please try again or contact support if the issue persists.";
    }
  }

  /**
   * Analyze market conditions and provide insights
   */
  async analyzeMarket(request: MarketAnalysisRequest): Promise<MarketAnalysisResponse> {
    try {
      const prompt = `Analyze the current market conditions for these tokens on Sei Network: ${request.tokens.join(', ')}

Timeframe: ${request.timeframe}
${request.context ? `Additional context: ${request.context}` : ''}

Provide a comprehensive analysis including:
1. Overall market sentiment (bullish/neutral/bearish)
2. Key factors affecting these tokens
3. Price trend analysis
4. Trading recommendations
5. Risk assessment

Return response as JSON with:
- analysis: detailed market analysis text
- sentiment: 'bullish' | 'neutral' | 'bearish'
- confidence: 0-1 confidence score
- keyFactors: array of key market factors
- recommendations: array of actionable recommendations`;

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(response) as MarketAnalysisResponse;

    } catch (error) {
      logger.error('❌ Error analyzing market:', error);
      return {
        analysis: 'Unable to analyze market conditions at this time.',
        sentiment: 'neutral',
        confidence: 0.1,
        keyFactors: ['Market analysis temporarily unavailable'],
        recommendations: ['Please try again later']
      };
    }
  }

  /**
   * Generate risk assessment for trading strategy
   */
  async assessRisk(intent: TradingIntent, portfolioData?: any): Promise<{
    riskLevel: 'low' | 'medium' | 'high';
    riskFactors: string[];
    recommendations: string[];
    maxRecommendedAmount?: string;
  }> {
    try {
      const prompt = `Assess the risk level for this trading strategy on Sei Network:

Strategy: ${JSON.stringify(intent)}
${portfolioData ? `Portfolio context: ${JSON.stringify(portfolioData)}` : ''}

Evaluate:
1. Risk level (low/medium/high)
2. Specific risk factors
3. Risk mitigation recommendations
4. Suggested position sizing

Return JSON response with:
- riskLevel: 'low' | 'medium' | 'high'
- riskFactors: array of risk factors
- recommendations: array of risk mitigation suggestions
- maxRecommendedAmount: suggested max amount (if applicable)`;

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(response);

    } catch (error) {
      logger.error('❌ Error assessing risk:', error);
      return {
        riskLevel: 'high',
        riskFactors: ['Unable to assess risk properly'],
        recommendations: ['Proceed with extreme caution', 'Consider smaller position sizes']
      };
    }
  }
}

export default OpenAIService;