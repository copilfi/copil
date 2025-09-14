import { DeFiAction, Intent, SwapIntent, LimitOrderIntent, DCAIntent, BalanceIntent, PriceIntent } from '../types';

interface KeywordPattern {
  keywords: string[];
  action: DeFiAction;
  confidence: number;
}

export class IntentClassifier {
  private patterns: KeywordPattern[] = [
    // Swap patterns
    {
      keywords: ['swap', 'trade', 'exchange', 'convert', 'change'],
      action: DeFiAction.SWAP,
      confidence: 0.9
    },
    {
      keywords: ['buy', 'sell', 'to', 'for', 'into'],
      action: DeFiAction.SWAP,
      confidence: 0.7
    },
    
    // Limit order patterns
    {
      keywords: ['limit', 'limit order', 'when price', 'at price', 'target price'],
      action: DeFiAction.LIMIT_ORDER,
      confidence: 0.9
    },
    {
      keywords: ['if price reaches', 'when reaches', 'at target'],
      action: DeFiAction.LIMIT_ORDER,
      confidence: 0.8
    },
    
    // DCA patterns
    {
      keywords: ['dca', 'dollar cost averaging', 'regularly buy', 'auto buy', 'schedule'],
      action: DeFiAction.DCA,
      confidence: 0.9
    },
    {
      keywords: ['every day', 'every week', 'monthly', 'recurring', 'periodic'],
      action: DeFiAction.DCA,
      confidence: 0.7
    },
    
    // Balance patterns
    {
      keywords: ['balance', 'how much', 'my tokens', 'wallet', 'check'],
      action: DeFiAction.CHECK_BALANCE,
      confidence: 0.9
    },
    
    // Price patterns
    {
      keywords: ['price', 'cost', 'worth', 'value', 'rate'],
      action: DeFiAction.GET_PRICE,
      confidence: 0.8
    },
    
    // Order management patterns
    {
      keywords: ['cancel', 'cancel order', 'stop order', 'remove order'],
      action: DeFiAction.CANCEL_ORDER,
      confidence: 0.9
    },
    {
      keywords: ['my orders', 'active orders', 'pending orders', 'order status'],
      action: DeFiAction.VIEW_ORDERS,
      confidence: 0.9
    }
  ];

  private tokenRegex = /\b(?:SEI|WSEI|USDC|USDT|ETH|BTC|[A-Z]{2,6})\b/gi;
  private numberRegex = /\b\d+(?:\.\d+)?\b/g;
  private priceRegex = /\$?\d+(?:\.\d+)?/g;

  /**
   * Classify user input to determine intent and extract entities
   */
  classifyIntent(input: string): Intent {
    const normalizedInput = input.toLowerCase().trim();
    
    // Find matching patterns
    const matches = this.patterns
      .map(pattern => ({
        ...pattern,
        score: this.calculatePatternScore(normalizedInput, pattern.keywords)
      }))
      .filter(match => match.score > 0)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      return {
        action: DeFiAction.SWAP, // Default fallback
        confidence: 0.1,
        entities: {},
        rawText: input
      };
    }

    const bestMatch = matches[0];
    const entities = this.extractEntities(input, bestMatch.action);

    return {
      action: bestMatch.action,
      confidence: Math.min(bestMatch.score * bestMatch.confidence, 1.0),
      entities,
      rawText: input
    };
  }

  /**
   * Extract specific entities based on the detected action
   */
  private extractEntities(input: string, action: DeFiAction): Record<string, any> {
    const entities: Record<string, any> = {};

    // Extract tokens
    const tokens = this.extractTokens(input);
    if (tokens.length > 0) {
      entities.tokens = tokens;
    }

    // Extract numbers
    const numbers = this.extractNumbers(input);
    if (numbers.length > 0) {
      entities.amounts = numbers;
    }

    // Extract prices
    const prices = this.extractPrices(input);
    if (prices.length > 0) {
      entities.prices = prices;
    }

    // Action-specific entity extraction
    switch (action) {
      case DeFiAction.SWAP:
        return this.extractSwapEntities(input, entities);
      
      case DeFiAction.LIMIT_ORDER:
        return this.extractLimitOrderEntities(input, entities);
      
      case DeFiAction.DCA:
        return this.extractDCAEntities(input, entities);
      
      case DeFiAction.CHECK_BALANCE:
        return this.extractBalanceEntities(input, entities);
      
      case DeFiAction.GET_PRICE:
        return this.extractPriceEntities(input, entities);
      
      default:
        return entities;
    }
  }

  private extractSwapEntities(input: string, baseEntities: Record<string, any>): SwapIntent {
    const tokens = baseEntities.tokens || [];
    const amounts = baseEntities.amounts || [];

    // Detect swap direction patterns
    const fromToMatch = input.match(/(\\w+)\\s+(?:to|for|into|->)\\s+(\\w+)/i);
    const swapPatterns = [
      /swap\\s+(\\d+(?:\\.\\d+)?)\\s+(\\w+)\\s+(?:to|for|into)\\s+(\\w+)/i,
      /buy\\s+(\\w+)\\s+with\\s+(\\d+(?:\\.\\d+)?)\\s+(\\w+)/i,
      /sell\\s+(\\d+(?:\\.\\d+)?)\\s+(\\w+)\\s+for\\s+(\\w+)/i
    ];

    let tokenFrom = '';
    let tokenTo = '';
    let amount = 0;

    // Try pattern matching first
    for (const pattern of swapPatterns) {
      const match = input.match(pattern);
      if (match) {
        if (pattern.source.includes('buy')) {
          tokenTo = match[1];
          amount = parseFloat(match[2]);
          tokenFrom = match[3];
        } else {
          amount = parseFloat(match[1]);
          tokenFrom = match[2];
          tokenTo = match[3];
        }
        break;
      }
    }

    // Fallback to token order
    if (!tokenFrom && tokens.length >= 1) {
      tokenFrom = tokens[0];
      tokenTo = tokens.length >= 2 ? tokens[1] : '';
    }

    if (!amount && amounts.length > 0) {
      amount = amounts[0];
    }

    return {
      tokenFrom,
      tokenTo,
      amount,
      slippage: this.extractSlippage(input),
      deadline: this.extractDeadline(input)
    };
  }

  private extractLimitOrderEntities(input: string, baseEntities: Record<string, any>): LimitOrderIntent {
    const tokens = baseEntities.tokens || [];
    const amounts = baseEntities.amounts || [];
    const prices = baseEntities.prices || [];

    const orderType = input.includes('buy') ? 'buy' : 'sell';
    
    return {
      tokenFrom: tokens[0] || '',
      tokenTo: tokens[1] || '',
      amount: amounts[0] || 0,
      targetPrice: prices[0] || amounts[amounts.length - 1] || 0,
      orderType,
      deadline: this.extractDeadline(input)
    };
  }

  private extractDCAEntities(input: string, baseEntities: Record<string, any>): DCAIntent {
    const tokens = baseEntities.tokens || [];
    const amounts = baseEntities.amounts || [];

    // Extract frequency
    let frequency: 'daily' | 'weekly' | 'monthly' | number = 'weekly';
    
    if (input.includes('daily') || input.includes('every day')) {
      frequency = 'daily';
    } else if (input.includes('weekly') || input.includes('every week')) {
      frequency = 'weekly';
    } else if (input.includes('monthly') || input.includes('every month')) {
      frequency = 'monthly';
    } else {
      // Look for custom intervals
      const intervalMatch = input.match(/every\\s+(\\d+)\\s+(hours?|days?)/i);
      if (intervalMatch) {
        const value = parseInt(intervalMatch[1]);
        const unit = intervalMatch[2].toLowerCase();
        frequency = unit.startsWith('hour') ? value : value * 24;
      }
    }

    return {
      tokenFrom: tokens[0] || '',
      tokenTo: tokens[1] || '',
      totalBudget: amounts[0] || 0,
      frequency,
      duration: this.extractDuration(input)
    };
  }

  private extractBalanceEntities(input: string, baseEntities: Record<string, any>): BalanceIntent {
    const tokens = baseEntities.tokens || [];
    
    return {
      token: tokens[0]
    };
  }

  private extractPriceEntities(input: string, baseEntities: Record<string, any>): PriceIntent {
    const tokens = baseEntities.tokens || [];
    
    return {
      token: tokens[0] || '',
      vs: tokens[1] || 'USDC'
    };
  }

  private extractTokens(input: string): string[] {
    const matches = input.match(this.tokenRegex) || [];
    return [...new Set(matches.map(token => token.toUpperCase()))];
  }

  private extractNumbers(input: string): number[] {
    const matches = input.match(this.numberRegex) || [];
    return matches.map(num => parseFloat(num));
  }

  private extractPrices(input: string): number[] {
    const matches = input.match(this.priceRegex) || [];
    return matches.map(price => parseFloat(price.replace('$', '')));
  }

  private extractSlippage(input: string): number | undefined {
    const slippageMatch = input.match(/(\\d+(?:\\.\\d+)?)%?\\s*slippage/i);
    return slippageMatch ? parseFloat(slippageMatch[1]) : undefined;
  }

  private extractDeadline(input: string): number | undefined {
    const deadlineMatch = input.match(/(\\d+)\\s*(hours?|minutes?|days?)/i);
    if (deadlineMatch) {
      const value = parseInt(deadlineMatch[1]);
      const unit = deadlineMatch[2].toLowerCase();
      
      if (unit.startsWith('minute')) {
        return value / 60; // Convert to hours
      } else if (unit.startsWith('day')) {
        return value * 24; // Convert to hours
      }
      return value; // Already in hours
    }
    return undefined;
  }

  private extractDuration(input: string): number | undefined {
    const durationMatch = input.match(/(?:for|over)\\s+(\\d+)\\s*(days?|weeks?|months?)/i);
    if (durationMatch) {
      const value = parseInt(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      
      if (unit.startsWith('week')) {
        return value * 7; // Convert to days
      } else if (unit.startsWith('month')) {
        return value * 30; // Convert to days
      }
      return value; // Already in days
    }
    return undefined;
  }

  private calculatePatternScore(input: string, keywords: string[]): number {
    let score = 0;
    const inputWords = input.split(/\\s+/);
    
    for (const keyword of keywords) {
      const keywordWords = keyword.split(/\\s+/);
      
      if (keywordWords.length === 1) {
        // Single word keyword
        if (inputWords.includes(keyword)) {
          score += 1.0 / keywords.length;
        }
      } else {
        // Multi-word phrase
        if (input.includes(keyword)) {
          score += 1.5 / keywords.length; // Bonus for phrase matches
        }
      }
    }
    
    return Math.min(score, 1.0);
  }
}