import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '@/utils/logger';

// Store CSRF tokens in memory (in production, use Redis)
const csrfTokens = new Map<string, { token: string; expires: number }>();

export interface CSRFRequest extends Request {
  csrfToken?: string;
}

// Generate CSRF token
export const generateCSRFToken = (sessionId: string): string => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + (60 * 60 * 1000); // 1 hour
  
  csrfTokens.set(sessionId, { token, expires });
  
  return token;
};

// CSRF protection middleware
export const csrfProtection = (
  req: CSRFRequest,
  res: Response,
  next: NextFunction
): void => {
  // Skip CSRF for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  try {
    const sessionId = req.sessionID || req.headers['x-session-id'] as string;
    const providedToken = req.headers['x-csrf-token'] as string || req.body._csrf;

    if (!sessionId) {
      res.status(403).json({
        success: false,
        error: 'Session required for CSRF protection'
      });
      return;
    }

    if (!providedToken) {
      res.status(403).json({
        success: false,
        error: 'CSRF token required'
      });
      return;
    }

    const storedTokenData = csrfTokens.get(sessionId);
    
    if (!storedTokenData) {
      res.status(403).json({
        success: false,
        error: 'Invalid or expired CSRF token'
      });
      return;
    }

    // Check if token is expired
    if (Date.now() > storedTokenData.expires) {
      csrfTokens.delete(sessionId);
      res.status(403).json({
        success: false,
        error: 'CSRF token expired'
      });
      return;
    }

    // Compare tokens using constant-time comparison
    if (!crypto.timingSafeEqual(
      Buffer.from(providedToken, 'hex'),
      Buffer.from(storedTokenData.token, 'hex')
    )) {
      logger.warn(`CSRF token mismatch for session: ${sessionId}`);
      res.status(403).json({
        success: false,
        error: 'Invalid CSRF token'
      });
      return;
    }

    req.csrfToken = providedToken;
    next();
  } catch (error) {
    logger.error('CSRF protection error:', error);
    res.status(500).json({
      success: false,
      error: 'CSRF validation failed'
    });
  }
};

// Cleanup expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, tokenData] of csrfTokens.entries()) {
    if (now > tokenData.expires) {
      csrfTokens.delete(sessionId);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour

export default {
  generateCSRFToken,
  csrfProtection
};