import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@/config/database';
import { logger } from '@/utils/logger';
import env from '@/config/env';
import TokenService, { TokenPayload } from '@/services/TokenService';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    address: string;
    walletAddress: string; // Add walletAddress for backward compatibility
    email?: string;
  };
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    // Verify token with blacklist checking
    const decoded = await TokenService.verifyAccessToken(token);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Verify user still exists in database and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, walletAddress: true, email: true, isActive: true }
    });

    if (!user || !user.isActive) {
      // Blacklist token if user is deactivated
      await TokenService.blacklistToken(token, 'user_deactivated');
      res.status(401).json({ error: 'Invalid token or user not found' });
      return;
    }

    req.user = {
      id: user.id,
      address: user.walletAddress,
      walletAddress: user.walletAddress, // Add walletAddress for backward compatibility
      email: user.email || undefined
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const generateToken = (payload: {
  userId: string;
  address: string;
  email?: string;
}): string => {
  return TokenService.generateAccessToken(payload);
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      next();
      return;
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      userId: string;
      address: string;
      email?: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, walletAddress: true, email: true, isActive: true }
    });

    if (user && user.isActive) {
      req.user = {
        id: user.id,
        address: user.walletAddress,
        walletAddress: user.walletAddress, // Add walletAddress for backward compatibility
        email: user.email || undefined
      };
    }

    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    next();
  }
};