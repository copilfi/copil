import { Router } from 'express';
import Joi from 'joi';
import { AuthController } from '@/controllers/AuthController';
import { authenticateToken } from '@/middleware/auth';
import { validateBody } from '@/middleware/validation';
import { commonSchemas } from '@/middleware/validation';
import { generateApiKey, securityLevel } from '@/middleware/security';
import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';
import {
  authRateLimit,
  strictRateLimit,
  refreshTokenRateLimit,
  AdvancedRateLimiter
} from '@/middleware/rateLimiter';
import TokenService from '@/services/TokenService';

const router = Router();
const prisma = new PrismaClient();

// Apply IP block checker to all routes
router.use(AdvancedRateLimiter.blockChecker());

// Validation schemas
const registerSchema = Joi.object({
  address: commonSchemas.address,
  signature: Joi.string().required(),
  message: Joi.string().required(),
  email: Joi.string().email().optional(),
  password: Joi.string().min(8).optional()
});

const loginSchema = Joi.object({
  address: commonSchemas.address,
  signature: Joi.string().required(),
  message: Joi.string().required()
});

const generateMessageSchema = Joi.object({
  address: commonSchemas.address
});

const updatePreferencesSchema = Joi.object({
  riskTolerance: Joi.string().valid('low', 'medium', 'high').optional(),
  defaultSlippage: Joi.number().min(0.1).max(10).optional(),
  enableNotifications: Joi.boolean().optional(),
  autoApprove: Joi.boolean().optional()
}).options({ allowUnknown: true });

// New API key management schemas
const generateApiKeySchema = Joi.object({
  walletAddress: commonSchemas.address,
  permissions: Joi.array().items(Joi.string().valid('read', 'write', 'admin', 'pro', 'premium')).default([])
});

const revokeApiKeySchema = Joi.object({
  walletAddress: commonSchemas.address
});

// Routes with appropriate rate limiting (temporarily disabled for debugging)
router.post('/register', authRateLimit, validateBody(registerSchema), AuthController.register);
router.post('/login', authRateLimit, validateBody(loginSchema), AuthController.login);
router.post('/generate-message', authRateLimit, validateBody(generateMessageSchema), AuthController.generateMessage);
router.post('/logout', authenticateToken, AuthController.logout);
router.get('/profile', authenticateToken, AuthController.getProfile);
router.put('/preferences', authenticateToken, validateBody(updatePreferencesSchema), AuthController.updatePreferences);
router.post('/preferences', authenticateToken, validateBody(updatePreferencesSchema), AuthController.updatePreferences);

// API Key Management Routes
router.post('/generate-api-key', strictRateLimit, validateBody(generateApiKeySchema), async (req, res) => {
  try {
    const { walletAddress, permissions } = req.body;

    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { walletAddress }
    });

    // Generate new API key
    const { apiKey, hashedKey } = generateApiKey();

    if (user) {
      // Update existing user
      user = await prisma.user.update({
        where: { walletAddress },
        data: {
          apiKeyHash: hashedKey,
          permissions: permissions,
          lastLoginAt: new Date()
        }
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          walletAddress,
          apiKeyHash: hashedKey,
          permissions: permissions,
          preferences: {}
        }
      });
    }

    logger.info(`🔑 Generated API key for wallet: ${walletAddress}`);

    res.status(201).json({
      success: true,
      data: {
        apiKey,
        userId: user.id,
        walletAddress: user.walletAddress,
        permissions: permissions,
        usage: {
          rateLimit: permissions.includes('premium') ? '1000/min' : 
                    permissions.includes('pro') ? '500/min' : '100/min'
        }
      },
      message: 'API key generated successfully',
      warning: 'Store this API key securely. It will not be shown again.'
    });

  } catch (error) {
    logger.error('Error generating API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate API key'
    });
  }
});

router.post('/revoke-api-key', strictRateLimit, validateBody(revokeApiKeySchema), async (req, res) => {
  try {
    const { walletAddress } = req.body;

    const user = await prisma.user.findUnique({
      where: { walletAddress }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Remove API key
    await prisma.user.update({
      where: { walletAddress },
      data: {
        apiKeyHash: null,
        permissions: []
      }
    });

    logger.info(`🗑️  Revoked API key for wallet: ${walletAddress}`);

    res.json({
      success: true,
      message: 'API key revoked successfully'
    });

  } catch (error) {
    logger.error('Error revoking API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke API key'
    });
  }
});

// Refresh Token Endpoint
router.post('/refresh', refreshTokenRateLimit, authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const currentToken = authHeader && authHeader.split(' ')[1];

    if (!currentToken) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    // Get refresh token from cookies or request body
    let refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      // If no refresh token provided, try to extract from current token's user
      const decoded = await TokenService.verifyAccessToken(currentToken);
      if (!decoded) {
        return res.status(401).json({
          success: false,
          error: 'Invalid current token'
        });
      }

      // Generate a new refresh token for the user (fallback for existing sessions)
      refreshToken = await TokenService.generateRefreshToken(decoded.userId);
    }

    // Verify and rotate the refresh token
    const tokenData = await TokenService.verifyAndRotateRefreshToken(refreshToken);

    if (!tokenData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    }

    // Get user data to include in new access token
    const user = await prisma.user.findUnique({
      where: { id: tokenData.userId },
      select: {
        id: true,
        walletAddress: true,
        email: true,
        isActive: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'User not found or inactive'
      });
    }

    // Generate new access token with proper user data
    const newAccessToken = TokenService.generateAccessToken({
      userId: user.id,
      address: user.walletAddress,
      email: user.email || undefined
    });

    // Set new refresh token in httpOnly cookie (more secure)
    res.cookie('refreshToken', tokenData.newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    logger.info(`🔄 Token refreshed for user: ${user.id}`);

    res.json({
      success: true,
      data: {
        token: newAccessToken,
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          email: user.email
        }
      },
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    logger.error('Token refresh failed:', error);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
});

export default router;
