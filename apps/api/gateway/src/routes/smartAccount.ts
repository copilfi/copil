import express from 'express';
import { body, validationResult } from 'express-validator';
import { prisma, UserRepository } from '@copil/database';
import { logger } from '../utils/logger';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { ethers } from 'ethers';

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
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const userWalletAddress = (req as any).user?.walletAddress;

    logger.info(`🚀 Smart Account deployment request:`, {
      userId,
      userWalletAddress,
      hasUser: !!(req as any).user,
      userObject: (req as any).user ? 'present' : 'missing'
    });

    try {
      // Validate required data from authentication
      if (!userId) {
        logger.error('User ID is missing from authenticated request');
        return res.status(400).json({
          success: false,
          error: 'User ID is required',
          code: 'USER_ID_REQUIRED',
        });
      }

      if (!userWalletAddress) {
        logger.error('User wallet address is missing from authenticated request');
        return res.status(400).json({
          success: false,
          error: 'User wallet address is required',
          code: 'WALLET_ADDRESS_REQUIRED',
        });
      }

      // Check if user exists
      const user = await userRepository.findById(userId);

      if (!user) {
        logger.error(`User not found in database: ${userId}`);
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

      // Get environment variables for deployment
      const factoryAddress = process.env.ACCOUNT_FACTORY_ADDRESS;
      const automationPrivateKey = process.env.AUTOMATION_PRIVATE_KEY;
      const rpcUrl = process.env.ALCHEMY_SEI_RPC_URL || process.env.SEI_RPC_URL;

      if (!factoryAddress) {
        throw new Error('ACCOUNT_FACTORY_ADDRESS not configured in environment');
      }

      if (!automationPrivateKey) {
        throw new Error('AUTOMATION_PRIVATE_KEY not configured in environment');
      }

      if (!rpcUrl) {
        throw new Error('SEI RPC URL not configured in environment');
      }

      // Generate deterministic salt based on user wallet address (bytes32)
      const userSalt = ethers.keccak256(ethers.toUtf8Bytes(userWalletAddress));

      // Salt from contract: _getSalt(owner, salt) = keccak256(abi.encodePacked(owner, salt))
      const combinedSalt = ethers.keccak256(ethers.solidityPacked(
        ["address", "bytes32"],
        [userWalletAddress, userSalt]
      ));

      // Create provider and wallet for deployment
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const automationWallet = new ethers.Wallet(automationPrivateKey, provider);

      // Account Factory ABI (with getAddress for prediction)
      const factoryABI = [
        "function createAccount(address owner, bytes32 salt) external returns (address)",
        "function getAddress(address owner, bytes32 salt) external view returns (address)"
      ];

      const factoryContract = new ethers.Contract(factoryAddress, factoryABI, automationWallet);

      // Get predicted address from the contract
      const predictedAddress = await factoryContract.getAddress(userWalletAddress, userSalt);

      logger.info(`🎯 Predicted Smart Account address: ${predictedAddress}`);

      let smartAccountAddress: string;
      let transactionHash: string;

      try {
        // Check if the account is already deployed by checking code at predicted address
        const code = await provider.getCode(predictedAddress);

        if (code !== '0x') {
          // Account already deployed
          logger.info(`✅ Smart Account already deployed at: ${predictedAddress}`);
          smartAccountAddress = predictedAddress;
          transactionHash = 'already_deployed';
        } else {
          // Deploy the account using automation wallet (platform pays gas)
          logger.info(`🚀 Deploying Smart Account for user ${userWalletAddress} using automation wallet...`);

          const tx = await factoryContract.createAccount(userWalletAddress, userSalt);
          const receipt = await tx.wait();

          transactionHash = receipt.hash;
          smartAccountAddress = predictedAddress; // CREATE2 ensures this is the correct address

          logger.info(`✅ Smart Account deployed successfully:`, {
            userWalletAddress,
            smartAccountAddress,
            transactionHash,
            gasUsed: receipt.gasUsed.toString(),
            gasPrice: receipt.gasPrice?.toString()
          });
        }
      } catch (deployError) {
        logger.error('❌ Smart Account deployment failed:', deployError);
        throw new Error(`Smart Account deployment failed: ${deployError.message}`);
      }

      // Update user with smart account address
      const updatedUser = await userRepository.updateSmartAccountAddress(userId, smartAccountAddress as `0x${string}`);

      logger.info(`Smart account deployed for user ${userId}`, {
        userId,
        smartAccountAddress,
        walletAddress: user.walletAddress,
      });

      res.json({
        success: true,
        message: transactionHash === 'already_deployed'
          ? 'Smart account was already deployed'
          : 'Smart account deployed successfully',
        data: {
          smartAccountAddress: updatedUser.smartAccountAddress,
          hasSmartAccount: true,
          needsDeployment: false,
          deploymentStatus: 'deployed',
          transactionHash: transactionHash !== 'already_deployed' ? transactionHash : undefined,
          isExisting: transactionHash === 'already_deployed'
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