import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';

const prisma = new PrismaClient();
import { AuthenticatedRequest } from '@/middleware/auth';
import { asyncHandler, AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import blockchainService from '@/services/RealBlockchainService';
import PrivateKeyService from '@/services/PrivateKeyService';

export class SmartAccountController {
  /**
   * Deploy Smart Account for authenticated user (gas sponsored by platform)
   */
  static deployAccount = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    try {
      logger.info(`🚀 Starting Smart Account deployment for user: ${req.user.walletAddress}`);

      // Check if Smart Account is already deployed
      const existingAccount = await prisma.smartAccount.findFirst({
        where: {
          userId: req.user.id,
          isActive: true
        }
      });

      if (existingAccount) {
        logger.info(`✅ Found existing Smart Account: ${existingAccount.address}`);
        return res.json({
          success: true,
          message: 'Smart Account already deployed',
          data: {
            address: existingAccount.address,
            deployedAt: existingAccount.deployedAt,
            isExisting: true
          }
        });
      }

      // Deploy Smart Account with gas sponsored by platform
      logger.info(`💰 Deploying Smart Account with platform-sponsored gas for: ${req.user.walletAddress}`);
      const smartAccountAddress = await blockchainService.deploySmartAccount(req.user.walletAddress);

      // Save to database
      const smartAccount = await prisma.smartAccount.create({
        data: {
          userId: req.user.id,
          address: smartAccountAddress,
          saltNonce: ethers.keccak256(ethers.toUtf8Bytes(req.user.walletAddress)),
          isActive: true,
          deployedAt: new Date()
        }
      });

      logger.info(`✅ Smart Account deployed and recorded: ${smartAccountAddress}`);

      res.json({
        success: true,
        message: 'Smart Account deployed successfully with sponsored gas',
        data: {
          address: smartAccountAddress,
          deployedAt: smartAccount.deployedAt,
          gasSponsoredByPlatform: true,
          isExisting: false
        }
      });
    } catch (error) {
      logger.error('Smart Account deployment failed:', error);
      throw new AppError('Failed to deploy Smart Account', 500);
    }
  });

  /**
   * Prepare Smart Account deployment for frontend execution (legacy method)
   */
  static prepareDeployment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    try {
      logger.info(`🚀 Preparing Smart Account deployment for user: ${req.user.walletAddress}`);

      // Check if Smart Account is already deployed
      const existingAccount = await prisma.smartAccount.findFirst({
        where: {
          userId: req.user.id,
          isActive: true
        }
      });

      if (existingAccount) {
        logger.info(`✅ Found existing Smart Account: ${existingAccount.address}`);
        return res.json({
          success: true,
          message: 'Smart Account already deployed',
          data: {
            address: existingAccount.address,
            deployedAt: existingAccount.deployedAt,
            isExisting: true
          }
        });
      }

      // Prepare deployment transaction data for MetaMask
      const deploymentResult = await blockchainService.prepareSmartAccountDeployment(req.user.walletAddress);

      // If already deployed, return the deployed address info and save to DB if not exists
      if (deploymentResult.isAlreadyDeployed) {
        logger.info(`✅ Smart Account already deployed on blockchain: ${deploymentResult.address}`);

        // Ensure it's recorded in database
        const existingRecord = await prisma.smartAccount.findFirst({
          where: {
            userId: req.user.id,
            address: deploymentResult.address,
            isActive: true
          }
        });

        if (!existingRecord) {
          await prisma.smartAccount.create({
            data: {
              userId: req.user.id,
              address: deploymentResult.address,
              saltNonce: deploymentResult.salt || '0x0',
              isActive: true,
              deployedAt: new Date()
            }
          });
          logger.info(`📝 Smart Account recorded in database: ${deploymentResult.address}`);
        }

        return res.json({
          success: true,
          message: 'Smart Account already deployed on blockchain',
          data: {
            transactionData: null,
            isAlreadyDeployed: true,
            address: deploymentResult.address,
            userAddress: req.user.walletAddress
          }
        });
      }

      logger.info(`📋 Smart Account deployment transaction prepared for: ${req.user.walletAddress}`);
      res.json({
        success: true,
        message: 'Smart Account deployment transaction prepared',
        data: {
          transactionData: deploymentResult.transactionData,
          isAlreadyDeployed: false,
          address: deploymentResult.estimatedAddress,
          userAddress: req.user.walletAddress
        }
      });
    } catch (error) {
      logger.error('Smart Account deployment preparation failed:', error);
      throw new AppError('Failed to prepare Smart Account deployment', 500);
    }
  });

  /**
   * Confirm Smart Account deployment after transaction completion
   */
  static confirmDeployment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    const { transactionHash, contractAddress } = req.body;

    try {
      logger.info(`🔍 Confirming Smart Account deployment for user: ${req.user.walletAddress}`);
      logger.info(`   Transaction Hash: ${transactionHash}`);
      logger.info(`   Contract Address: ${contractAddress}`);

      // Verify transaction exists and is confirmed
      const provider = new ethers.JsonRpcProvider(
        process.env.NODE_ENV === 'production' 
          ? process.env.ALCHEMY_SEI_RPC_URL || process.env.SEI_MAINNET_RPC_URL 
          : process.env.SEI_TESTNET_RPC_URL
      );

      const txReceipt = await provider.getTransactionReceipt(transactionHash);
      if (!txReceipt) {
        throw new AppError('Transaction not found or not confirmed yet', 400);
      }

      if (txReceipt.status !== 1) {
        throw new AppError('Transaction failed', 400);
      }

      // Calculate the expected Smart Account address
      const expectedAddress = await blockchainService.getSmartAccountAddress(req.user.walletAddress);
      
      // Use provided address or expected address
      const smartAccountAddress = contractAddress || expectedAddress;

      // Save to database
      const existingRecord = await prisma.smartAccount.findFirst({
        where: { 
          userId: req.user.id,
          address: smartAccountAddress,
          isActive: true 
        }
      });

      if (!existingRecord) {
        const smartAccount = await prisma.smartAccount.create({
          data: {
            userId: req.user.id,
            address: smartAccountAddress,
            saltNonce: ethers.keccak256(ethers.toUtf8Bytes(req.user.walletAddress)),
            isActive: true,
            deployedAt: new Date()
          }
        });

        logger.info(`✅ Smart Account deployment confirmed and recorded: ${smartAccountAddress}`);

        res.json({
          success: true,
          message: 'Smart Account deployment confirmed successfully',
          data: {
            smartAccount,
            transactionHash,
            blockNumber: txReceipt.blockNumber,
            gasUsed: txReceipt.gasUsed.toString()
          }
        });
      } else {
        logger.info(`📝 Smart Account already recorded in database: ${smartAccountAddress}`);
        res.json({
          success: true,
          message: 'Smart Account deployment already confirmed',
          data: {
            smartAccount: existingRecord,
            transactionHash,
            blockNumber: txReceipt.blockNumber,
            gasUsed: txReceipt.gasUsed.toString()
          }
        });
      }
    } catch (error) {
      logger.error('Smart Account deployment confirmation failed:', error);
      throw new AppError('Failed to confirm Smart Account deployment', 500);
    }
  });

  /**
   * Get Smart Account information
   */
  static getAccountInfo = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    try {
      logger.info(`🔍 Getting Smart Account info for user: ${req.user.walletAddress}`);
      // Get Smart Account address
      const smartAccountAddress = await blockchainService.getSmartAccountAddress(req.user.walletAddress);
      
      // Get account info from blockchain
      const client = await blockchainService.getSmartAccountClient(req.user.walletAddress);
      const accountInfo = await client.getAccountInfo();
      
      logger.info(`📊 Smart Account info retrieved: ${JSON.stringify(accountInfo, null, 2)}`);
      
      // Get from database
      const dbAccount = await prisma.smartAccount.findFirst({
        where: { 
          userId: req.user.id,
          isActive: true 
        }
      });

      res.json({
        success: true,
        data: {
          address: accountInfo.address,
          owner: accountInfo.owner,
          nonce: accountInfo.nonce,
          balance: accountInfo.balance,
          isDeployed: accountInfo.isDeployed,
          databaseRecord: dbAccount
        }
      });
    } catch (error) {
      logger.error('Failed to get Smart Account info:', error);
      throw new AppError('Failed to get account information', 500);
    }
  });

  /**
   * Execute transaction through Smart Account
   */
  static executeTransaction = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    const { to, value, data, privateKey } = req.body;

    try {
      logger.info(`🔄 Executing transaction for user: ${req.user.walletAddress}`);
      const txHash = await blockchainService.executeTransaction(
        req.user.walletAddress,
        to,
        value || '0',
        data || '0x',
        privateKey
      );

      // Log transaction
      await prisma.transaction.create({
        data: {
          txHash: txHash,
          userId: req.user.id,
          type: 'SMART_ACCOUNT_EXECUTION',
          status: 'PENDING',
          details: {
            to,
            value: value || '0',
            data: data || '0x'
          }
        }
      });

      res.json({
        success: true,
        message: 'Transaction executed successfully',
        data: {
          transactionHash: txHash
        }
      });
    } catch (error) {
      logger.error('Transaction execution failed:', error);
      throw new AppError('Failed to execute transaction', 500);
    }
  });

  /**
   * Execute batch transactions
   */
  static executeBatch = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    const { transactions, privateKey } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new AppError('Transactions array is required', 400);
    }

    try {
      logger.info(`🔄 Executing batch transactions for user: ${req.user.walletAddress}`);
      const txHash = await blockchainService.executeBatchTransactions(
        req.user.walletAddress,
        transactions,
        privateKey
      );

      // Log batch transaction
      await prisma.transaction.create({
        data: {
          txHash: txHash,
          userId: req.user.id,
          type: 'SMART_ACCOUNT_BATCH',
          status: 'PENDING',
          details: {
            batchSize: transactions.length,
            transactions
          }
        }
      });

      res.json({
        success: true,
        message: 'Batch transaction executed successfully',
        data: {
          transactionHash: txHash,
          batchSize: transactions.length
        }
      });
    } catch (error) {
      logger.error('Batch transaction execution failed:', error);
      throw new AppError('Failed to execute batch transaction', 500);
    }
  });

  /**
   * Create session key for automated trading
   */
  static createSessionKey = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    const {
      sessionKey,
      validUntil,
      limitAmount,
      allowedTargets,
      allowedFunctions,
      description,
      privateKey
    } = req.body;

    try {
      logger.info(`🔑 Creating session key for user: ${req.user.walletAddress}`);
      // Create session key on blockchain with platform-sponsored transaction (no private key needed from user)
      const txHash = await blockchainService.createSessionKey(
        req.user.walletAddress,
        {
          sessionKey,
          validUntil,
          limitAmount,
          allowedTargets: allowedTargets || [],
          allowedFunctions: allowedFunctions || []
        }
        // No privateKey parameter - let the service use platform wallet for gas sponsorship
      );

      // Get Smart Account from database
      const smartAccount = await prisma.smartAccount.findFirst({
        where: { 
          userId: req.user.id,
          isActive: true 
        }
      });

      if (!smartAccount) {
        throw new AppError('Smart Account not found', 404);
      }

      // Save session key to database
      const dbSessionKey = await prisma.sessionKey.create({
        data: {
          sessionId: req.user.sessions?.[0]?.id || 'default-session',
          address: sessionKey,
          validUntil: new Date(validUntil * 1000),
          validAfter: new Date(),
          limitAmount,
          allowedTargets: allowedTargets || [],
          allowedFunctions: allowedFunctions || [],
          isActive: true
        },
        select: {
          id: true,
          address: true,
          validUntil: true,
          limitAmount: true,
          createdAt: true
        }
      });

      res.status(201).json({
        success: true,
        message: 'Session key created successfully',
        data: {
          sessionKey: dbSessionKey,
          transactionHash: txHash
        }
      });
    } catch (error) {
      logger.error('Session key creation failed:', error);
      throw new AppError('Failed to create session key', 500);
    }
  });

  /**
   * Revoke session key
   */
  static revokeSessionKey = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    // Validate user wallet address
    if (!req.user.walletAddress) {
      logger.error('User wallet address is missing from request');
      throw new AppError('User wallet address is required', 400);
    }

    const { sessionKey, privateKey } = req.body;

    try {
      logger.info(`🔒 Revoking session key for user: ${req.user.walletAddress}`);
      // Revoke on blockchain
      const txHash = await blockchainService.revokeSessionKey(
        req.user.walletAddress,
        sessionKey,
        privateKey
      );

      // Update database
      await prisma.sessionKey.updateMany({
        where: {
          address: sessionKey,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      res.json({
        success: true,
        message: 'Session key revoked successfully',
        data: {
          transactionHash: txHash
        }
      });
    } catch (error) {
      logger.error('Session key revocation failed:', error);
      throw new AppError('Failed to revoke session key', 500);
    }
  });

  /**
   * List user's session keys
   */
  static listSessionKeys = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { page = 1, limit = 10, includeInactive = false } = req.query;

    const sessionKeys = await prisma.sessionKey.findMany({
      where: {
        session: {
          userId: req.user.id
        },
        ...(includeInactive !== 'true' && { isActive: true })
      },
      select: {
        id: true,
        address: true,
        validUntil: true,
        limitAmount: true,
        usageCount: true,
        isActive: true,
        createdAt: true,
        allowedTargets: true,
        allowedFunctions: true
      },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit)
    });

    const total = await prisma.sessionKey.count({
      where: {
        session: {
          userId: req.user.id
        },
        ...(includeInactive !== 'true' && { isActive: true })
      }
    });

    res.json({
      success: true,
      data: {
        sessionKeys,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  });

  /**
   * Revoke session key by ID
   */
  static revokeSessionKeyById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { sessionKeyId } = req.params;

    try {
      // Find the session key
      const sessionKey = await prisma.sessionKey.findFirst({
        where: {
          id: sessionKeyId,
          session: {
            userId: req.user.id
          },
          isActive: true
        }
      });

      if (!sessionKey) {
        throw new AppError('Session key not found', 404);
      }

      // Mark as inactive in database (soft delete)
      await prisma.sessionKey.update({
        where: { id: sessionKeyId },
        data: { isActive: false }
      });

      res.json({
        success: true,
        message: 'Session key revoked successfully'
      });
    } catch (error) {
      logger.error('Session key revocation failed:', error);
      throw new AppError('Failed to revoke session key', 500);
    }
  });
}