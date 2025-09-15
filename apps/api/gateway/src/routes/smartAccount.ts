import express from 'express';
import { body, validationResult } from 'express-validator';
import { prisma, UserRepository } from '@copil/database';
import { logger } from '../utils/logger';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const userRepository = new UserRepository(prisma);

// Get smart account info
router.get('/info', authMiddleware, asyncHandler(async (req, res) => {
  const userId = (req as any).user?.id;

  try {
    const user = await userRepository.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const hasSmartAccount = !!user.smartAccountAddress;
    const needsDeployment = !hasSmartAccount;

    res.json({
      success: true,
      data: {
        smartAccountAddress: user.smartAccountAddress,
        hasSmartAccount,
        needsDeployment,
        deploymentStatus: hasSmartAccount ? 'deployed' : 'not_deployed',
      },
    });

  } catch (error) {
    logger.error('Get smart account info error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get smart account info',
      code: 'SMART_ACCOUNT_INFO_FAILED',
    });
  }
}));

// Deploy smart account
router.post('/deploy',
  authMiddleware,
  [
    body('smartAccountAddress')
      .isEthereumAddress()
      .withMessage('Invalid smart account address'),
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

    const userId = (req as any).user?.id;
    const { smartAccountAddress } = req.body;

    try {
      // Check if user exists
      const user = await userRepository.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        });
      }

      // Check if user already has a smart account
      if (user.smartAccountAddress) {
        return res.status(409).json({
          success: false,
          error: 'Smart account already deployed',
          code: 'SMART_ACCOUNT_EXISTS',
          data: {
            smartAccountAddress: user.smartAccountAddress,
          },
        });
      }

      // Update user with smart account address
      const updatedUser = await userRepository.updateSmartAccountAddress(userId, smartAccountAddress);

      logger.info(`Smart account deployed for user ${userId}`, {
        userId,
        smartAccountAddress,
        walletAddress: user.walletAddress,
      });

      res.json({
        success: true,
        message: 'Smart account deployed successfully',
        data: {
          smartAccountAddress: updatedUser.smartAccountAddress,
          hasSmartAccount: true,
          needsDeployment: false,
          deploymentStatus: 'deployed',
        },
      });

    } catch (error) {
      logger.error('Smart account deployment error:', error);
      return res.status(500).json({
        success: false,
        error: 'Smart account deployment failed',
        code: 'SMART_ACCOUNT_DEPLOYMENT_FAILED',
      });
    }
  })
);

// Get smart account deployment status
router.get('/status', authMiddleware, asyncHandler(async (req, res) => {
  const userId = (req as any).user?.id;

  try {
    const user = await userRepository.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const hasSmartAccount = !!user.smartAccountAddress;

    res.json({
      success: true,
      data: {
        hasSmartAccount,
        needsDeployment: !hasSmartAccount,
        deployedAt: hasSmartAccount ? user.createdAt : null,
        smartAccountAddress: user.smartAccountAddress,
      },
    });

  } catch (error) {
    logger.error('Get smart account status error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get smart account status',
      code: 'SMART_ACCOUNT_STATUS_FAILED',
    });
  }
}));

export default router;