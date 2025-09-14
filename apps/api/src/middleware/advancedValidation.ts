import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '@/utils/logger';
import { AppError } from '@/middleware/errorHandler';

export interface ValidationOptions {
  allowUnknown?: boolean;
  stripUnknown?: boolean;
  sanitize?: boolean;
  maxDepth?: number;
}

export class AdvancedValidator {
  private static readonly MAX_STRING_LENGTH = 10000;
  private static readonly MAX_ARRAY_LENGTH = 1000;
  private static readonly MAX_OBJECT_DEPTH = 10;
  
  // Security patterns
  private static readonly SUSPICIOUS_PATTERNS = [
    /(<script[^>]*>.*?<\/script>)/gi,           // XSS Scripts
    /javascript:/gi,                             // JavaScript protocol
    /data:.*base64/gi,                          // Base64 data URLs
    /on\w+\s*=/gi,                              // Event handlers
    /eval\s*\(/gi,                              // eval() calls
    /(union|select|insert|update|delete|drop|create|alter)\s/gi, // SQL injection
    /__proto__|constructor|prototype/gi,         // Prototype pollution
    /\$\{.*\}/g,                                // Template injection
    /<%.*%>/g,                                  // Server-side template injection
  ];

  private static readonly XSS_PATTERNS = [
    /<[^>]*script[^>]*>/gi,
    /<[^>]*on\w+[^>]*>/gi,
    /href\s*=\s*["']?javascript:/gi,
    /src\s*=\s*["']?javascript:/gi,
  ];

  private static readonly SQL_PATTERNS = [
    /'(\s*;?\s*(union|select|insert|update|delete|drop|create|alter))/gi,
    /--/g,
    /\/\*[\s\S]*?\*\//g,
    /;\s*(drop|delete|truncate|update)/gi,
  ];

  /**
   * Enhanced validation middleware with security checks
   */
  static validateAdvanced(
    schema: Joi.ObjectSchema, 
    options: ValidationOptions = {}
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const { 
          allowUnknown = false, 
          stripUnknown = true, 
          sanitize = true,
          maxDepth = this.MAX_OBJECT_DEPTH 
        } = options;

        // Check request size and depth
        this.validateRequestSize(req);
        
        // Sanitize input if enabled
        if (sanitize) {
          req.body = this.sanitizeInput(req.body, maxDepth);
        }

        // Security scan for malicious content
        this.securityScan(req.body);

        // Joi validation
        const { error, value } = schema.validate(req.body, {
          allowUnknown,
          stripUnknown,
          abortEarly: false,
          convert: true,
          presence: 'required'
        });

        if (error) {
          const details = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value
          }));

          logger.warn('Validation failed:', { 
            path: req.path, 
            errors: details,
            ip: this.getClientIP(req)
          });

          throw new AppError('Validation failed', 400, { details });
        }

        // Apply validated and sanitized values
        req.body = value;
        next();

      } catch (error) {
        if (error instanceof AppError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message,
            details: error.details
          });
        } else {
          logger.error('Validation middleware error:', error);
          res.status(500).json({
            success: false,
            error: 'Validation processing failed'
          });
        }
      }
    };
  }

  /**
   * Sanitize input data recursively
   */
  private static sanitizeInput(data: any, maxDepth: number, currentDepth = 0): any {
    if (currentDepth >= maxDepth) {
      throw new AppError('Maximum nesting depth exceeded', 400);
    }

    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }

    if (Array.isArray(data)) {
      if (data.length > this.MAX_ARRAY_LENGTH) {
        throw new AppError('Array too large', 400);
      }
      return data.map(item => this.sanitizeInput(item, maxDepth, currentDepth + 1));
    }

    if (data && typeof data === 'object') {
      const sanitized: any = {};
      const keys = Object.keys(data);
      
      if (keys.length > 100) {
        throw new AppError('Too many object properties', 400);
      }

      for (const key of keys) {
        // Sanitize key names
        const sanitizedKey = this.sanitizeString(key);
        if (sanitizedKey !== key) {
          logger.warn(`Suspicious object key detected: ${key}`);
        }
        
        sanitized[sanitizedKey] = this.sanitizeInput(
          data[key], 
          maxDepth, 
          currentDepth + 1
        );
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Sanitize string values
   */
  private static sanitizeString(value: string): string {
    if (typeof value !== 'string') return value;
    
    if (value.length > this.MAX_STRING_LENGTH) {
      throw new AppError('String too long', 400);
    }

    // Remove null bytes
    value = value.replace(/\0/g, '');
    
    // Normalize unicode
    value = value.normalize('NFKC');
    
    // Trim whitespace
    value = value.trim();

    return value;
  }

  /**
   * Scan for malicious patterns
   */
  private static securityScan(data: any): void {
    const dataString = JSON.stringify(data).toLowerCase();

    // Check for suspicious patterns
    for (const pattern of this.SUSPICIOUS_PATTERNS) {
      if (pattern.test(dataString)) {
        logger.error('Malicious content detected:', {
          pattern: pattern.toString(),
          data: JSON.stringify(data).substring(0, 200)
        });
        throw new AppError('Malicious content detected', 400);
      }
    }

    // Specific XSS check
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(dataString)) {
        logger.error('XSS attempt detected:', {
          pattern: pattern.toString(),
          data: JSON.stringify(data).substring(0, 200)
        });
        throw new AppError('XSS attempt detected', 400);
      }
    }

    // Specific SQL injection check
    for (const pattern of this.SQL_PATTERNS) {
      if (pattern.test(dataString)) {
        logger.error('SQL injection attempt detected:', {
          pattern: pattern.toString(),
          data: JSON.stringify(data).substring(0, 200)
        });
        throw new AppError('SQL injection attempt detected', 400);
      }
    }
  }

  /**
   * Validate request size
   */
  private static validateRequestSize(req: Request): void {
    const contentLength = parseInt(req.get('content-length') || '0');
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (contentLength > maxSize) {
      throw new AppError('Request payload too large', 413);
    }

    // Check for deeply nested objects
    if (req.body) {
      const bodyString = JSON.stringify(req.body);
      if (bodyString.length > maxSize) {
        throw new AppError('Request body too large', 413);
      }
    }
  }

  /**
   * Get client IP address
   */
  private static getClientIP(req: Request): string {
    return req.get('X-Forwarded-For')?.split(',')[0] || 
           req.get('X-Real-IP') || 
           req.connection.remoteAddress || 
           'unknown';
  }

  /**
   * File upload validation
   */
  static validateFileUpload(
    allowedTypes: string[] = [],
    maxSize: number = 5 * 1024 * 1024,
    maxFiles: number = 10
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const files = req.files;
        
        if (!files) {
          return next();
        }

        const fileArray = Array.isArray(files) ? files : [files];
        
        if (fileArray.length > maxFiles) {
          throw new AppError(`Too many files. Maximum ${maxFiles} allowed`, 400);
        }

        for (const file of fileArray) {
          // Size check
          if (file.size > maxSize) {
            throw new AppError(`File too large. Maximum ${maxSize} bytes allowed`, 400);
          }

          // Type check
          if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
            throw new AppError(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`, 400);
          }

          // Filename security check
          if (file.originalname && /[<>:"|?*\x00-\x1f]/.test(file.originalname)) {
            throw new AppError('Invalid filename characters', 400);
          }
        }

        next();
      } catch (error) {
        if (error instanceof AppError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message
          });
        } else {
          logger.error('File validation error:', error);
          res.status(500).json({
            success: false,
            error: 'File validation failed'
          });
        }
      }
    };
  }

  /**
   * Rate-limited validation (for expensive operations)
   */
  static rateLimitedValidation(schema: Joi.ObjectSchema, rateLimit: number = 10) {
    const requestCounts = new Map<string, { count: number; resetTime: number }>();
    const windowMs = 60 * 1000; // 1 minute window

    return (req: Request, res: Response, next: NextFunction) => {
      const clientIP = this.getClientIP(req);
      const now = Date.now();
      const windowStart = now - windowMs;

      // Clean expired entries
      for (const [ip, data] of requestCounts.entries()) {
        if (data.resetTime < windowStart) {
          requestCounts.delete(ip);
        }
      }

      // Check rate limit
      const current = requestCounts.get(clientIP);
      if (current && current.count >= rateLimit && current.resetTime > windowStart) {
        return res.status(429).json({
          success: false,
          error: 'Validation rate limit exceeded',
          retryAfter: Math.ceil((current.resetTime - now) / 1000)
        });
      }

      // Update count
      if (current && current.resetTime > windowStart) {
        current.count++;
      } else {
        requestCounts.set(clientIP, { count: 1, resetTime: now + windowMs });
      }

      // Apply standard validation
      this.validateAdvanced(schema)(req, res, next);
    };
  }
}

// Enhanced common schemas with security validation
export const secureSchemas = {
  address: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid Ethereum address format'
    }),

  privateKey: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid private key format'
    }),

  amount: Joi.string()
    .pattern(/^\d+(\.\d+)?$/)
    .custom((value, helpers) => {
      const num = parseFloat(value);
      if (num < 0) return helpers.error('number.min');
      if (num > 1e18) return helpers.error('number.max');
      return value;
    })
    .messages({
      'number.min': 'Amount cannot be negative',
      'number.max': 'Amount too large',
      'string.pattern.base': 'Invalid amount format'
    }),

  tokenAddress: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{40}$/)
    .messages({
      'string.pattern.base': 'Invalid token address format'
    }),

  signature: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{130}$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid signature format'
    }),

  email: Joi.string()
    .email({ tlds: { allow: true } })
    .max(100)
    .lowercase()
    .trim(),

  url: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(2048),

  uuid: Joi.string()
    .pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    .messages({
      'string.pattern.base': 'Invalid UUID format'
    }),

  safeText: Joi.string()
    .max(1000)
    .pattern(/^[a-zA-Z0-9\s\-_.,:;!?()]+$/)
    .messages({
      'string.pattern.base': 'Text contains invalid characters'
    })
};

export default AdvancedValidator;