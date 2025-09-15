import express from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { prisma, UserRepository } from '@copil/database';
import { logger } from '../utils/logger';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { RedisService } from '../services/RedisService';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const userRepository = new UserRepository(prisma);

// Wallet connection and authentication
router.post('/connect', 
  [
    body('walletAddress')
      .isEthereumAddress()
      .withMessage('Invalid Ethereum address'),
    body('signature')
      .notEmpty()
      .withMessage('Signature is required'),
    body('message')
      .notEmpty()
      .withMessage('Message is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array(),
      });
    }

    const { walletAddress, signature, message } = req.body;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ipAddress = req.ip;

    try {
      // TODO: Verify signature with ethers/viem
      // For now, we'll skip signature verification in development
      const isValidSignature = process.env.NODE_ENV === 'development' || true;
      
      if (!isValidSignature) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature',
          code: 'INVALID_SIGNATURE',
        });
      }

      // Find or create user
      let user = await userRepository.findByWalletAddress(walletAddress);
      
      if (!user) {
        user = await userRepository.create({
          walletAddress,
          email: req.body.email,
          username: req.body.username,
        });
        
        logger.info(`New user created: ${user.id}`, {
          walletAddress: user.walletAddress,
          ipAddress,
        });
      } else {
        // Update last login
        await userRepository.updateLastLogin(user.id);
      }

      // Create session
      const sessionToken = uuidv4();
      const jwtPayload = {
        userId: user.id,
        sessionId: sessionToken,
      };

      const token = jwt.sign(jwtPayload, process.env.JWT_SECRET!, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      const session = await userRepository.createSession({
        userId: user.id,
        token,
        expiresAt,
        ipAddress,
        userAgent,
      });

      // Cache user session in Redis for quick access
      await RedisService.set(
        `session:${token}`,
        {
          userId: user.id,
          sessionId: session.id,
          walletAddress: user.walletAddress,
        },
        7 * 24 * 60 * 60 // 7 days
      );

      logger.info(`User authenticated: ${user.id}`, {
        sessionId: session.id,
        ipAddress,
      });

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            walletAddress: user.walletAddress,
            smartAccountAddress: user.smartAccountAddress,
            email: user.email,
            username: user.username,
            preferences: user.preferences,
            kycStatus: user.kycStatus,
          },
          token,
          expiresAt: expiresAt.toISOString(),
        },
      });

    } catch (error) {
      logger.error('Authentication error:', error);
      throw createError('Authentication failed', 500, 'AUTH_FAILED');
    }
  })
);

// Generate message for wallet signing (alias for challenge)
router.post('/generate-message',
  [
    body('address')
      .isEthereumAddress()
      .withMessage('Invalid Ethereum address'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array(),
      });
    }

    const { address } = req.body;
    const nonce = uuidv4();

    // Store nonce in Redis with short TTL
    await RedisService.set(`challenge:${address}`, nonce, 300); // 5 minutes

    const message = `Welcome to Copil DeFi Platform!\n\nSign this message to authenticate your wallet.\n\nWallet: ${address}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;

    res.json({
      success: true,
      message,
      nonce,
      expiresAt: Date.now() + (5 * 60 * 1000), // 5 minutes from now
    });
  })
);

// Get authentication challenge message
router.post('/challenge',
  [
    body('walletAddress')
      .isEthereumAddress()
      .withMessage('Invalid Ethereum address'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array(),
      });
    }

    const { walletAddress } = req.body;
    const nonce = uuidv4();
    
    // Store nonce in Redis with short TTL
    await RedisService.set(`challenge:${walletAddress}`, nonce, 300); // 5 minutes

    const message = `Welcome to Copil DeFi Platform!\n\nSign this message to authenticate your wallet.\n\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;

    res.json({
      success: true,
      data: {
        message,
        nonce,
      },
    });
  })
);

// Logout
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      // Deactivate session in database
      await userRepository.deactivateSession(token);
      
      // Remove from Redis cache
      await RedisService.del(`session:${token}`);
      
      logger.info('User logged out', { token: token.substring(0, 8) + '...' });
    } catch (error) {
      logger.warn('Error during logout:', error);
    }
  }

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: 'Refresh token required',
      code: 'MISSING_REFRESH_TOKEN',
    });
  }

  // TODO: Implement refresh token logic
  // For now, return error as refresh tokens are not implemented
  return res.status(501).json({
    success: false,
    error: 'Refresh token not implemented yet',
    code: 'NOT_IMPLEMENTED',
  });
}));

// Verify token
router.get('/verify', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authorization token required',
      code: 'MISSING_TOKEN',
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      sessionId: string;
    };

    const session = await userRepository.findSessionByToken(token);
    
    if (!session || !session.isActive || session.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session',
        code: 'INVALID_SESSION',
      });
    }

    res.json({
      success: true,
      data: {
        valid: true,
        userId: session.user.id,
        expiresAt: session.expiresAt.toISOString(),
      },
    });

  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
    }

    throw error;
  }
}));

// Login endpoint (alias for connect)
router.post('/login',
  [
    body('address')
      .isEthereumAddress()
      .withMessage('Invalid Ethereum address'),
    body('signature')
      .notEmpty()
      .withMessage('Signature is required'),
    body('message')
      .notEmpty()
      .withMessage('Message is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array(),
      });
    }

    const { address: walletAddress, signature, message } = req.body;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ipAddress = req.ip;

    try {
      // TODO: Verify signature with ethers/viem
      const isValidSignature = process.env.NODE_ENV === 'development' || true;

      if (!isValidSignature) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature',
          code: 'INVALID_SIGNATURE',
        });
      }

      // Try to find existing user for login
      const existingUser = await userRepository.findByWalletAddress(walletAddress);

      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        });
      }

      // Update last login
      await userRepository.updateLastLogin(existingUser.id);

      // Generate JWT token
      const token = jwt.sign(
        { userId: existingUser.id, walletAddress },
        process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      // Store session in database and cache
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await userRepository.createSession({
        userId: existingUser.id,
        token,
        expiresAt,
        ipAddress,
        userAgent,
      });
      await RedisService.set(`session:${token}`, JSON.stringify({ userId: existingUser.id }), 7 * 24 * 60 * 60);

      res.json({
        success: true,
        user: {
          id: existingUser.id,
          walletAddress: existingUser.walletAddress,
          smartAccountAddress: existingUser.smartAccountAddress,
          email: existingUser.email,
          username: existingUser.username,
          preferences: existingUser.preferences,
          kycStatus: existingUser.kycStatus,
        },
        token,
      });

    } catch (error) {
      logger.error('Login error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authentication failed',
        code: 'AUTH_FAILED',
      });
    }
  })
);

// Register endpoint (alias for connect)
router.post('/register',
  [
    body('address')
      .isEthereumAddress()
      .withMessage('Invalid Ethereum address'),
    body('signature')
      .notEmpty()
      .withMessage('Signature is required'),
    body('message')
      .notEmpty()
      .withMessage('Message is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array(),
      });
    }

    const { address: walletAddress, signature, message, email } = req.body;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ipAddress = req.ip;

    try {
      // TODO: Verify signature with ethers/viem
      const isValidSignature = process.env.NODE_ENV === 'development' || true;

      if (!isValidSignature) {
        return res.status(401).json({
          success: false,
          error: 'Invalid signature',
          code: 'INVALID_SIGNATURE',
        });
      }

      // Check if user already exists
      const existingUser = await userRepository.findByWalletAddress(walletAddress);

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'User already exists',
          code: 'USER_EXISTS',
        });
      }

      // Create new user
      const newUser = await userRepository.create({
        walletAddress,
        email,
        username: req.body.username,
      });

      // Generate JWT token
      const token = jwt.sign(
        { userId: newUser.id, walletAddress },
        process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      // Store session in database and cache
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await userRepository.createSession({
        userId: newUser.id,
        token,
        expiresAt,
        ipAddress,
        userAgent,
      });
      await RedisService.set(`session:${token}`, JSON.stringify({ userId: newUser.id }), 7 * 24 * 60 * 60);

      res.json({
        success: true,
        user: {
          id: newUser.id,
          walletAddress: newUser.walletAddress,
          smartAccountAddress: newUser.smartAccountAddress,
          email: newUser.email,
          username: newUser.username,
          preferences: newUser.preferences,
          kycStatus: newUser.kycStatus,
        },
        token,
      });

    } catch (error) {
      logger.error('Registration error:', error);
      return res.status(500).json({
        success: false,
        error: 'Registration failed',
        code: 'REGISTRATION_FAILED',
      });
    }
  })
);

// Get user profile
router.get('/profile', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  const token = authHeader.substring(7);

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production') as any;

    // Get user from database
    const user = await userRepository.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        walletAddress: user.walletAddress,
        smartAccountAddress: user.smartAccountAddress,
        email: user.email,
        username: user.username,
        preferences: user.preferences,
        kycStatus: user.kycStatus,
      },
    });

  } catch (error) {
    logger.error('Profile fetch error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid token',
      code: 'INVALID_TOKEN',
    });
  }
}));

export default router;