import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
import { generateToken, AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler, AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import blockchainService from '@/services/RealBlockchainService';
import AuthHelpers from '@/utils/authHelpers';

export class AuthController {
  /**
   * Register a new user with wallet address
   */
  static register = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { address, signature, message, email, password } = req.body;

    // Validate message format
    if (!AuthHelpers.validateMessageFormat(message, address)) {
      throw new AppError('Invalid message format', 400);
    }

    // Extract nonce from message
    const nonce = AuthHelpers.extractNonceFromMessage(message);
    if (!nonce) {
      throw new AppError('Nonce not found in message', 400);
    }

    // Verify signature with replay protection
    const isValidSignature = await AuthHelpers.verifySignatureWithNonce(
      message,
      signature,
      address,
      nonce
    );

    if (!isValidSignature) {
      throw new AppError('Invalid signature or replay attack detected', 400);
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { walletAddress: address.toLowerCase() }
    });

    if (existingUser) {
      throw new AppError('User with this address already exists', 400);
    }

    let hashedPassword;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 12);
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        walletAddress: address.toLowerCase(),
        email: email?.toLowerCase(),
        isActive: true,
        preferences: {
          riskTolerance: 'medium',
          defaultSlippage: 1.0,
          enableNotifications: true,
          autoApprove: false
        }
      },
      select: {
        id: true,
        walletAddress: true,
        email: true,
        createdAt: true,
        preferences: true
      }
    });

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      address: user.walletAddress,
      email: user.email || undefined
    });

    // Deploy Smart Account in background
    try {
      const smartAccountAddress = await blockchainService.getSmartAccountAddress(user.walletAddress);
      logger.info(`Smart Account address for ${user.walletAddress}: ${smartAccountAddress}`);
      
      // Update user with smart account address
      await prisma.user.update({
        where: { id: user.id },
        data: { smartAccountAddress }
      });
    } catch (error) {
      logger.error('Failed to get Smart Account address during registration:', error);
      // Continue with registration even if smart account fails
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        token
      }
    });
  });

  /**
   * Login with wallet signature
   */
  static login = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { address, signature, message } = req.body;

    // Validate message format
    if (!AuthHelpers.validateMessageFormat(message, address)) {
      throw new AppError('Invalid message format', 400);
    }

    // Extract nonce from message
    const nonce = AuthHelpers.extractNonceFromMessage(message);
    if (!nonce) {
      throw new AppError('Nonce not found in message', 400);
    }

    // First validate signature without consuming nonce
    const isValidSignature = await AuthHelpers.validateSignatureWithNonce(
      message,
      signature,
      address,
      nonce
    );

    if (!isValidSignature) {
      throw new AppError('Invalid signature or replay attack detected', 400);
    }

    // Check if user exists before consuming nonce
    const user = await prisma.user.findUnique({
      where: { 
        walletAddress: address.toLowerCase(),
        isActive: true 
      },
      select: {
        id: true,
        walletAddress: true,
        email: true,
        lastLoginAt: true,
        preferences: true
      }
    });

    if (!user) {
      throw new AppError('User not found or inactive', 404);
    }

    // Now consume the nonce since user exists and signature is valid
    const nonceConsumed = await AuthHelpers.verifyAndConsumeNonce(nonce, address);
    if (!nonceConsumed) {
      throw new AppError('Nonce verification failed', 400);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      address: user.walletAddress,
      email: user.email || undefined
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token
      }
    });
  });

  /**
   * Get current user profile
   */
  static getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        walletAddress: true,
        smartAccountAddress: true,
        email: true,
        createdAt: true,
        lastLoginAt: true,
        preferences: true,
        smartAccounts: {
          select: {
            id: true,
            address: true,
            isActive: true,
            deployedAt: true
          },
          where: { isActive: true }
        },
        strategies: {
          select: {
            id: true,
            name: true,
            type: true,
            isActive: true,
            createdAt: true
          },
          where: { isActive: true }
        }
      }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Get Smart Account address and balance
    let smartAccountInfo = null;
    try {
      const smartAccountAddress = await blockchainService.getSmartAccountAddress(user.walletAddress);
      const balance = await blockchainService.getBalance(smartAccountAddress);
      
      smartAccountInfo = {
        address: smartAccountAddress,
        balance
      };
    } catch (error) {
      logger.error('Failed to get Smart Account info:', error);
    }

    // Calculate Smart Account deployment status
    const hasActiveSmartAccount = user.smartAccounts && user.smartAccounts.length > 0;
    const smartAccountDeploymentStatus = {
      hasSmartAccount: hasActiveSmartAccount,
      deployedAt: hasActiveSmartAccount ? user.smartAccounts[0].deployedAt : null,
      needsDeployment: !hasActiveSmartAccount
    };

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          smartAccountDeploymentStatus
        },
        smartAccount: smartAccountInfo
      }
    });
  });

  /**
   * Update user preferences
   */
  static updatePreferences = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { riskTolerance, defaultSlippage, enableNotifications, autoApprove } = req.body;

    // Get current preferences
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { preferences: true }
    });

    const currentPrefs = (currentUser?.preferences as any) || {};

    // Build updated preferences object
    const updatedPreferences = {
      ...currentPrefs,
      ...(riskTolerance && { riskTolerance }),
      ...(defaultSlippage !== undefined && { defaultSlippage: parseFloat(defaultSlippage.toString()) }),
      ...(enableNotifications !== undefined && { enableNotifications }),
      ...(autoApprove !== undefined && { autoApprove })
    };

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        preferences: updatedPreferences
      },
      select: {
        id: true,
        walletAddress: true,
        email: true,
        preferences: true
      }
    });

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      data: { user }
    });
  });

  /**
   * Generate message for signature
   */
  static generateMessage = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { address } = req.body;

    if (!address) {
      throw new AppError('Wallet address is required', 400);
    }

    // Generate secure nonce
    const nonceData = AuthHelpers.generateNonce(address);
    
    // Store nonce in Redis
    await AuthHelpers.storeNonce(nonceData);

    // Create secure message
    const message = AuthHelpers.createSignatureMessage(
      address,
      nonceData.nonce,
      nonceData.timestamp
    );

    res.json({
      success: true,
      data: { 
        message,
        nonce: nonceData.nonce,
        expiresAt: nonceData.expiresAt
      }
    });
  });

  /**
   * Logout with server-side token blacklisting
   */
  static logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      // Import TokenService here to avoid circular dependency
      const { default: TokenService } = await import('@/services/TokenService');
      await TokenService.logout(token);
      logger.info(`User logged out: ${req.user?.id || 'unknown'}`);
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });
}