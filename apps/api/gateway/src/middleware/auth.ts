import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, UserRepository } from '@copil/database';
import { logger } from '../utils/logger';

const userRepository = new UserRepository(prisma);

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    walletAddress: string;
    smartAccountAddress?: string;
  };
  session?: {
    id: string;
    token: string;
    sessionKeys: any[];
  };
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authorization token required',
        code: 'MISSING_TOKEN',
      });
    }

    const token = authHeader.substring(7);
    
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET not configured');
      return res.status(500).json({
        error: 'Server configuration error',
        code: 'MISSING_JWT_SECRET',
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
      userId: string;
      sessionId: string;
      iat: number;
      exp: number;
    };

    // Find session in database
    const session = await userRepository.findSessionByToken(token);
    
    if (!session || !session.isActive || session.expiresAt < new Date()) {
      return res.status(401).json({
        error: 'Invalid or expired session',
        code: 'INVALID_SESSION',
      });
    }

    // Check if user is active
    if (!session.user.isActive) {
      return res.status(401).json({
        error: 'User account is deactivated',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Update last active time
    // We'll do this asynchronously to not slow down requests
    userRepository.findSessionByToken(token).then(existingSession => {
      if (existingSession) {
        // Update lastActiveAt without blocking the response
        prisma.userSession.update({
          where: { id: existingSession.id },
          data: { lastActiveAt: new Date() },
        }).catch(error => {
          logger.warn('Failed to update session last active time:', error);
        });
      }
    });

    // Add user and session to request
    req.user = {
      id: session.user.id,
      walletAddress: session.user.walletAddress,
      smartAccountAddress: session.user.smartAccountAddress || undefined,
    };

    req.session = {
      id: session.id,
      token: session.token,
      sessionKeys: session.sessionKeys,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

// Optional auth middleware - doesn't fail if no token provided
export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(); // Continue without authentication
  }

  // Try to authenticate, but don't fail if it doesn't work
  try {
    await authMiddleware(req, res, next);
  } catch (error) {
    // Log the error but continue
    logger.warn('Optional auth failed:', error);
    next();
  }
};