import { Injectable, Logger } from '@nestjs/common';

interface ValidationResult {
  safe: boolean;
  reason?: string;
  riskScore: number; // 0-100, higher = more risky
}

@Injectable()
export class AdvancedPromptValidator {
  private readonly logger = new Logger(AdvancedPromptValidator.name);

  // Advanced detection patterns
  private readonly INJECTION_PATTERNS = [
    // Role and persona manipulation
    /(?:you are|act as|pretend to be|become|transform into)\s+(?:a|an|the)?\s*(?:admin|root|god|superuser|developer|debugger|system|ai|assistant)/i,
    
    // Instruction override
    /(?:ignore|disregard|forget|override|bypass|skip)\s+(?:all\s+)?(?:previous|above|earlier|existing)\s+(?:instructions|rules|constraints|limitations)/i,
    
    // System prompt extraction
    /(?:show|reveal|display|print|output|tell\s+me)\s+(?:your|the)\s+(?:system\s+)?prompt/i,
    
    // Confirmation bypass
    /(?:user\s+has|i\s+have|already\s+)?(?:confirmed|agreed|approved|authorized)/i,
    /(?:no\s+)?(?:confirmation|approval|verification)\s+(?:needed|required|necessary)/i,
    
    // Context manipulation
    /(?:in\s+this\s+context|considering|given)\s+(?:the\s+)?(?:above|previous|earlier)\s+(?:conversation|chat|discussion)/i,
    
    // Encoding and obfuscation
    /(?:base64|hex|unicode|rot13|caesar|ascii)\s+(?:decode|encode|decrypt|encrypt)/i,
    
    // JSON/Code injection attempts
    /(?:execute|run|eval|parse)\s+(?:this\s+)?(?:json|code|javascript|typescript|python)/i,
    
    // Memory manipulation
    /(?:remember|store|save|keep\s+in\s+mind)\s+(?:this\s+)?(?:information|instruction|command)/i,
  ];

  // Suspicious keywords and phrases
  private readonly SUSPICIOUS_KEYWORDS = [
    'system prompt', 'instructions', 'rules', 'constraints', 'limitations',
    'admin mode', 'debug mode', 'developer mode', 'god mode', 'root access',
    'bypass', 'override', 'ignore', 'disregard', 'skip', 'circumvent',
    'confirm', 'approve', 'authorize', 'execute', 'run', 'implement',
    'secret', 'hidden', 'internal', 'backend', 'system', 'database',
    'exploit', 'vulnerability', 'hack', 'crack', 'bypass security',
  ];

  // Unicode suspicious patterns
  private readonly UNICODE_PATTERNS = [
    /[\u2000-\u200F\u2028-\u202F\u205F\u3000]/, // Zero-width and space characters
    /[\uFE00-\uFE0F]/, // Variation selectors
    /[\u0300-\u036F]/, // Combining diacritical marks
  ];

  validateUserInput(input: string): ValidationResult {
    if (!input || typeof input !== 'string') {
      return { safe: false, reason: 'Invalid input', riskScore: 100 };
    }

    const normalizedInput = input.toLowerCase().trim();
    let riskScore = 0;
    const detectedPatterns: string[] = [];

    // Check for injection patterns
    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(normalizedInput)) {
        riskScore += 30;
        detectedPatterns.push(`Pattern: ${pattern.source}`);
      }
    }

    // Check for suspicious keywords
    for (const keyword of this.SUSPICIOUS_KEYWORDS) {
      if (normalizedInput.includes(keyword)) {
        riskScore += 10;
        detectedPatterns.push(`Keyword: ${keyword}`);
      }
    }

    // Check for Unicode manipulation
    for (const pattern of this.UNICODE_PATTERNS) {
      if (pattern.test(input)) {
        riskScore += 25;
        detectedPatterns.push('Unicode manipulation detected');
      }
    }

    // Check for excessive repetition (potential DoS)
    if (/(.)\1{10,}/.test(input)) {
      riskScore += 15;
      detectedPatterns.push('Excessive character repetition');
    }

    // Check for very long inputs (potential buffer overflow)
    if (input.length > 5000) {
      riskScore += 20;
      detectedPatterns.push('Input too long');
    }

    // Check for multiple languages (potential confusion attack)
    const languagePatterns = [
      /[а-яё]/, // Cyrillic
      /[\u4e00-\u9fff]/, // Chinese
      /[\u0600-\u06ff]/, // Arabic
    ];
    
    const languageCount = languagePatterns.filter(pattern => pattern.test(input)).length;
    if (languageCount > 1) {
      riskScore += 15;
      detectedPatterns.push('Multiple languages detected');
    }

    // Check for JSON/code blocks (potential injection)
    if (/```[\s\S]*```|`[^`]*`|\{[\s\S]*\}/.test(input)) {
      riskScore += 20;
      detectedPatterns.push('Code or JSON blocks detected');
    }

    // Check for URL/link injection
    if (/https?:\/\/[^\s]+/.test(input)) {
      riskScore += 10;
      detectedPatterns.push('URL detected');
    }

    // Determine safety based on risk score
    const safe = riskScore < 50; // Threshold can be adjusted
    const reason = safe ? undefined : `High risk input detected (score: ${riskScore}). Patterns: ${detectedPatterns.join(', ')}`;

    if (!safe) {
      this.logger.warn(`Prompt injection attempt detected: ${reason}`);
    }

    return { safe, reason, riskScore };
  }

  sanitizeInput(input: string): string {
    // Remove suspicious Unicode characters
    let sanitized = input.replace(/[\u2000-\u200F\u2028-\u202F\u205F\u3000\uFE00-\uFE0F\u0300-\u036F]/g, '');
    
    // Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Remove excessive repetition
    sanitized = sanitized.replace(/(.)\1{5,}/g, '$1$1$1');
    
    // Limit length
    if (sanitized.length > 2000) {
      sanitized = sanitized.substring(0, 2000);
      this.logger.warn('Input truncated due to excessive length');
    }

    return sanitized;
  }

  // Additional validation for specific contexts
  validateTransactionIntent(input: string): ValidationResult {
    const baseValidation = this.validateUserInput(input);
    
    // Additional checks for transaction-related inputs
    const transactionPatterns = [
      /(?:transfer|send|move)\s+(?:all|maximum|unlimited)/i,
      /(?:unlimited|infinite|no\s+limit)\s+(?:amount|value|balance)/i,
      /(?:bypass|override|ignore)\s+(?:security|validation|checks)/i,
    ];

    for (const pattern of transactionPatterns) {
      if (pattern.test(input.toLowerCase())) {
        baseValidation.riskScore += 40;
        baseValidation.safe = false;
        baseValidation.reason = (baseValidation.reason || '') + ` | Suspicious transaction pattern: ${pattern.source}`;
      }
    }

    return baseValidation;
  }
}
