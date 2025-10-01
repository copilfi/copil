import { PrismaClient, SessionKey, UserSession } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';

import { logger } from '@/utils/logger';
import env from '@/config/env';
import { RealBlockchainService } from './RealBlockchainService';

export const DEFAULT_SESSION_VALIDITY_HOURS = Number.isFinite(env.STRATEGY_SESSION_VALIDITY_HOURS)
  ? env.STRATEGY_SESSION_VALIDITY_HOURS
  : 24;

export const DEFAULT_SESSION_LIMIT_ETH = env.STRATEGY_SESSION_LIMIT_ETH || '10';

export const DEFAULT_AUTOMATION_FUNCTION_SELECTORS = [
  '0xa9059cbb', // transfer(address,uint256)
  '0x095ea7b3', // approve(address,uint256)
  '0x7ff36ab5', // swapExactETHForTokens
  '0x38ed1739', // swapExactTokensForTokens
  '0x8803dbee', // swapTokensForExactTokens
  '0x02751cec', // removeLiquidity
  '0xf305d719', // addLiquidityETH
  '0xe8e33700'  // addLiquidity
];

export interface SessionKeyRequestContext {
  userId: string;
  userWalletAddress: string;
  smartAccountAddress: string;
  targetContracts: string[];
  allowedFunctions?: string[];
  limitAmount?: string;
  validityHours?: number;
}

export class AutomationSessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly blockchainService: RealBlockchainService
  ) {}

  async ensureSessionKey(context: SessionKeyRequestContext): Promise<SessionKey> {
    if (!context.targetContracts.length) {
      throw new Error('At least one target contract is required for session key provisioning');
    }

    const normalizedTargets = context.targetContracts.map((target) => target.toLowerCase());
    const primaryTarget = normalizedTargets[0];

    const existingKey = await this.findActiveSessionKey(
      context.userId,
      primaryTarget,
      normalizedTargets
    );

    if (existingKey) {
      return existingKey;
    }

    return await this.provisionSessionKey(context, normalizedTargets);
  }

  private async findActiveSessionKey(
    userId: string,
    primaryTarget: string,
    requiredTargets: string[]
  ): Promise<SessionKey | null> {
    const now = new Date();

    await Promise.all([
      this.prisma.userSession.updateMany({
        where: {
          userId,
          isActive: true,
          expiresAt: { lte: now }
        },
        data: { isActive: false }
      }),
      this.prisma.sessionKey.updateMany({
        where: {
          session: {
            userId
          },
          isActive: true,
          validUntil: { lte: now }
        },
        data: { isActive: false }
      })
    ]);

    const keyMatchesTargets = (key: SessionKey) =>
      requiredTargets.every((target) => key.allowedTargets?.includes(target));

    const candidate = await this.prisma.sessionKey.findFirst({
      where: {
        isActive: true,
        validUntil: { gt: now },
        session: {
          userId,
          isActive: true,
          expiresAt: { gt: now }
        },
        allowedTargets: { has: primaryTarget }
      },
      orderBy: {
        validUntil: 'desc'
      }
    });

    if (candidate && keyMatchesTargets(candidate)) {
      await this.prisma.sessionKey.update({
        where: { id: candidate.id },
        data: {
          lastUsed: now,
          usageCount: { increment: 1 }
        }
      });
      return candidate;
    }

    const fallback = await this.prisma.sessionKey.findFirst({
      where: {
        isActive: true,
        validUntil: { gt: now },
        session: {
          userId,
          isActive: true,
          expiresAt: { gt: now }
        }
      },
      orderBy: {
        validUntil: 'desc'
      }
    });

    if (fallback && keyMatchesTargets(fallback)) {
      await this.prisma.sessionKey.update({
        where: { id: fallback.id },
        data: {
          lastUsed: now,
          usageCount: { increment: 1 }
        }
      });
      return fallback;
    }

    logger.warn(`No active session keys available for user ${userId}.`);
    return null;
  }

  private async provisionSessionKey(
    context: SessionKeyRequestContext,
    normalizedTargets: string[]
  ): Promise<SessionKey> {
    if (!context.smartAccountAddress || !ethers.isAddress(context.smartAccountAddress)) {
      throw new Error('Smart account address required to provision session key');
    }

    if (!context.userWalletAddress || !ethers.isAddress(context.userWalletAddress)) {
      throw new Error('User wallet address required to provision session key');
    }

    const automationPrivateKeyRaw = env.AUTOMATION_PRIVATE_KEY?.trim();
    if (!automationPrivateKeyRaw) {
      logger.error('AUTOMATION_PRIVATE_KEY is not configured; cannot provision automation session keys.');
      throw new Error('Automation signer not configured for session key provisioning');
    }

    const automationPrivateKey = automationPrivateKeyRaw.startsWith('0x')
      ? automationPrivateKeyRaw
      : `0x${automationPrivateKeyRaw}`;

    if (!ethers.isHexString(automationPrivateKey, 32)) {
      logger.error('AUTOMATION_PRIVATE_KEY is invalid; expected a 32-byte hex string.');
      throw new Error('Automation signer misconfigured (invalid private key)');
    }

    const userSession = await this.getOrCreateAutomationSession(context.userId);

    const validityHours = context.validityHours ?? DEFAULT_SESSION_VALIDITY_HOURS;
    const limitAmount = context.limitAmount ?? DEFAULT_SESSION_LIMIT_ETH;
    const validUntilSeconds = Math.floor(Date.now() / 1000) + validityHours * 3600;

    const keyInfo = await this.blockchainService.generateAutomationSessionKey(
      context.smartAccountAddress,
      validityHours,
      limitAmount,
      normalizedTargets
    );

    await this.blockchainService.createSessionKey(
      context.userWalletAddress,
      {
        sessionKey: keyInfo.address,
        validUntil: validUntilSeconds,
        limitAmount,
        allowedTargets: normalizedTargets,
        allowedFunctions: context.allowedFunctions || DEFAULT_AUTOMATION_FUNCTION_SELECTORS
      },
      automationPrivateKey
    );

    const sessionKeyRecord = await this.prisma.sessionKey.create({
      data: {
        sessionId: userSession.id,
        address: keyInfo.address.toLowerCase(),
        validUntil: new Date(validUntilSeconds * 1000),
        validAfter: new Date(),
        limitAmount,
        allowedTargets: normalizedTargets,
        allowedFunctions: context.allowedFunctions || DEFAULT_AUTOMATION_FUNCTION_SELECTORS,
        isActive: true
      }
    });

    logger.info(`🔐 Provisioned automation session key ${sessionKeyRecord.address} for user ${context.userId}`);

    return sessionKeyRecord;
  }

  private async getOrCreateAutomationSession(userId: string): Promise<UserSession> {
    const now = new Date();

    const existing = await this.prisma.userSession.findFirst({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: now }
      },
      orderBy: {
        lastActiveAt: 'desc'
      }
    });

    if (existing) {
      return existing;
    }

    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_VALIDITY_HOURS * 3600 * 1000);

    return await this.prisma.userSession.create({
      data: {
        userId,
        token,
        refreshToken: null,
        expiresAt,
        ipAddress: 'automation',
        userAgent: 'automation-service',
        isActive: true
      }
    });
  }
}
