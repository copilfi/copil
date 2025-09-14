import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import { prisma } from '@/config/database';

// Extended Request interface for security context
export interface SecureRequest extends Request {
  user?: {
    id: string;
    walletAddress: string;
    apiKey?: string;
    permissions?: string[];
  };
  signature?: {
    timestamp: number;
    signature: string;
    message: string;
  };
}

// API Key validation middleware
export const validateApiKey = async (
  req: SecureRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      res.status(401).json({
        success: false,
        error: 'API key required'
      });
      return;
    }

    // Hash the provided API key
    const hashedApiKey = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Find user by API key hash
    const user = await prisma.user.findFirst({
      where: {
        apiKeyHash: hashedApiKey,
        isActive: true
      },
      select: {
        id: true,
        walletAddress: true,
        apiKeyHash: true,
        permissions: true
      }
    });

    if (!user) {
      logger.warn(`Invalid API key attempted: ${apiKey.substring(0, 8)}...`);
      res.status(401).json({
        success: false,
        error: 'Invalid API key'
      });
      return;
    }

    // Add user to request context
    req.user = {
      id: user.id,
      walletAddress: user.walletAddress,
      apiKey,
      permissions: user.permissions as string[] || []
    };

    next();
  } catch (error) {
    logger.error('API key validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Wallet signature verification middleware
export const verifyWalletSignature = async (
  req: SecureRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const walletAddress = req.headers['x-wallet-address'] as string;
    const signature = req.headers['x-signature'] as string;
    const timestamp = req.headers['x-timestamp'] as string;
    const nonce = req.headers['x-nonce'] as string;

    if (!walletAddress || !signature || !timestamp || !nonce) {
      res.status(401).json({
        success: false,
        error: 'Missing signature headers: x-wallet-address, x-signature, x-timestamp, x-nonce required'
      });
      return;
    }

    // Check timestamp (must be within 2 minutes for better security)
    const now = Date.now();
    const requestTime = parseInt(timestamp);
    const maxAge = 2 * 60 * 1000; // 2 minutes

    if (now - requestTime > maxAge) {
      res.status(401).json({
        success: false,
        error: 'Request timestamp too old'
      });
      return;
    }

    // Create message to verify
    const method = req.method;
    const path = req.path;
    const body = req.method !== 'GET' ? JSON.stringify(req.body) : '';
    const message = `${method}:${path}:${body}:${timestamp}:${nonce}`;

    // Verify signature (this would need to be implemented based on wallet type)
    // For now, we'll implement a basic verification
    const isValidSignature = await verifyEthereumSignature(message, signature, walletAddress);

    if (!isValidSignature) {
      logger.warn(`Invalid signature from wallet: ${walletAddress}`);
      res.status(401).json({
        success: false,
        error: 'Invalid signature'
      });
      return;
    }

    // Add signature info to request
    req.signature = {
      timestamp: requestTime,
      signature,
      message
    };

    next();
  } catch (error) {
    logger.error('Signature verification error:', error);
    res.status(401).json({
      success: false,
      error: 'Signature verification failed'
    });
  }
};

// Permission check middleware
export const requirePermission = (requiredPermission: string) => {
  return (req: SecureRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
      return;
    }

    const hasPermission = req.user.permissions?.includes(requiredPermission) || 
                         req.user.permissions?.includes('admin');

    if (!hasPermission) {
      logger.warn(`Permission denied for user ${req.user.id}: required ${requiredPermission}`);
      res.status(403).json({
        success: false,
        error: `Permission required: ${requiredPermission}`
      });
      return;
    }

    next();
  };
};

// Enhanced rate limiting for different user tiers
export const createTieredRateLimit = () => {
  return async (req: SecureRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      let maxRequests = 10; // Default for unauthenticated
      let windowMs = 60 * 1000; // 1 minute

      if (user) {
        // Get user tier from database or permissions
        const permissions = user.permissions || [];
        
        if (permissions.includes('premium')) {
          maxRequests = 1000;
          windowMs = 60 * 1000; // 1000 per minute
        } else if (permissions.includes('pro')) {
          maxRequests = 500;
          windowMs = 60 * 1000; // 500 per minute
        } else {
          maxRequests = 100;
          windowMs = 60 * 1000; // 100 per minute
        }
      }

      // Create rate limiter instance
      const rateLimiter = rateLimit({
        windowMs,
        max: maxRequests,
        keyGenerator: (req) => {
          const secureReq = req as SecureRequest;
          return secureReq.user?.id || req.ip;
        },
        message: {
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil(windowMs / 1000)
        }
      });

      rateLimiter(req, res, next);
    } catch (error) {
      logger.error('Rate limit error:', error);
      next();
    }
  };
};

// Request encryption/decryption middleware (for sensitive data)
export const decryptRequest = async (
  req: SecureRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const encryptedData = req.headers['x-encrypted-payload'] as string;
    
    if (encryptedData && req.user?.apiKey) {
      // Decrypt request body using API key as symmetric key
      // Use createDecipheriv for better security (requires IV)
      const keyHash = crypto.createHash('sha256').update(req.user.apiKey).digest();
      const iv = Buffer.from(encryptedData.substring(0, 32), 'hex');
      const encryptedText = encryptedData.substring(32);
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      req.body = JSON.parse(decrypted);
      logger.debug('Request payload decrypted');
    }

    next();
  } catch (error) {
    logger.error('Request decryption error:', error);
    res.status(400).json({
      success: false,
      error: 'Invalid encrypted payload'
    });
  }
};

// CORS security headers
export const securityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Remove powered by header
  res.removeHeader('X-Powered-By');
  
  // HSTS header for production
  if (env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
};

// Helper function to verify Ethereum signature
async function verifyEthereumSignature(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<boolean> {
  try {
    // This is a simplified implementation
    // In production, you'd use ethers.js or web3.js to verify the signature
    const ethers = await import('ethers');
    
    // Create message hash
    const messageHash = ethers.hashMessage(message);
    
    // Recover address from signature
    const recoveredAddress = ethers.recoverAddress(messageHash, signature);
    
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch (error) {
    logger.error('Ethereum signature verification error:', error);
    return false;
  }
}

// Generate API key for user
export const generateApiKey = (): { apiKey: string; hashedKey: string } => {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  return { apiKey, hashedKey };
};

// Middleware composition for different security levels
export const securityLevel = {
  // Basic: Just security headers and basic rate limiting
  basic: [securityHeaders, createTieredRateLimit()],
  
  // Standard: API key + signature verification
  standard: [securityHeaders, validateApiKey, createTieredRateLimit()],
  
  // High: Standard + wallet signature verification
  high: [securityHeaders, validateApiKey, verifyWalletSignature, createTieredRateLimit()],
  
  // Maximum: High + encryption + specific permissions
  maximum: (permission: string) => [
    securityHeaders,
    validateApiKey,
    verifyWalletSignature,
    decryptRequest,
    requirePermission(permission),
    createTieredRateLimit()
  ]
};

export default {
  validateApiKey,
  verifyWalletSignature,
  requirePermission,
  createTieredRateLimit,
  decryptRequest,
  securityHeaders,
  generateApiKey,
  securityLevel
};