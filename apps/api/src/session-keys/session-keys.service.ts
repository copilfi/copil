import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionKey, SessionKeyPermissions, SessionActionType } from '@copil/database';
import { SmartAccountOrchestratorService } from '../smart-account/smart-account.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

interface CreateSessionKeyDto {
  publicKey: string;
  permissions: any;
  expiresAt?: string;
  isActive?: boolean;
}

interface UpdateSessionKeyDto {
  permissions?: any;
  expiresAt?: string;
  isActive?: boolean;
}

@Injectable()
export class SessionKeysService {
  constructor(
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
    private readonly orchestrator: SmartAccountOrchestratorService,
    private readonly configService: ConfigService,
  ) {}

  async create(userId: number, dto: CreateSessionKeyDto): Promise<SessionKey> {
    const existing = await this.sessionKeyRepository.findOne({
      where: { publicKey: dto.publicKey },
    });
    if (existing) {
      throw new ConflictException('Session key already registered.');
    }

    const permissions = this.mapPermissions(dto.permissions);

    // Strict permission validation - prevent empty/null permissions
    if (!permissions.actions || permissions.actions.length === 0) {
      throw new BadRequestException(
        'Session key must have at least one action permission.',
      );
    }

    if (!permissions.chains || permissions.chains.length === 0) {
      throw new BadRequestException(
        'Session key must have at least one chain permission.',
      );
    }

    const sessionKey = this.sessionKeyRepository.create({
      id: uuidv4(), // Generate UUID instead of sequential ID
      userId,
      publicKey: dto.publicKey,
      permissions,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.sessionKeyRepository.save(sessionKey);

    // Optional auto-deploy on session key creation
    if (this.configService.get<string>('AUTO_DEPLOY_ON_SESSION_KEY') === 'true') {
      const chain = this.configService.get<string>('DEFAULT_DEPLOY_CHAIN');
      if (chain && this.orchestrator) {
        void this.orchestrator
          .deploy(userId, saved.id, chain)
          .catch(() => void 0);
      }
    }

    return saved;
  }

  findAll(userId: number): Promise<SessionKey[]> {
    return this.sessionKeyRepository.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async update(
    id: string,
    userId: number,
    dto: UpdateSessionKeyDto,
  ): Promise<SessionKey> {
    const sessionKey = await this.sessionKeyRepository.findOne({
      where: { id, userId },
    });
    if (!sessionKey) {
      throw new NotFoundException(`Session key ${id} not found`);
    }

    // Update fields if provided
    if (dto.isActive !== undefined) {
      sessionKey.isActive = dto.isActive;
    }

    if (dto.expiresAt !== undefined) {
      sessionKey.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    if (dto.permissions !== undefined) {
      const permissions = this.mapPermissions(dto.permissions);
      if (!permissions.actions || permissions.actions.length === 0) {
        throw new BadRequestException(
          'Session key permissions.actions must be defined.',
        );
      }
      sessionKey.permissions = permissions;
    }

    return this.sessionKeyRepository.save(sessionKey);
  }

  private mapPermissions(permissions?: any): SessionKeyPermissions {
    if (!permissions) {
      return {};
    }

    const mapped: SessionKeyPermissions = {
      actions: permissions.actions?.map((action: any) => action as SessionActionType),
      chains: permissions.chains,
      allowedContracts: permissions.allowedContracts,
      spendLimits: permissions.spendLimits?.map((s: any) => ({
        token: s.token,
        maxAmount: s.maxAmount,
        windowSec: s.windowSec,
      })),
    };

    // Add hyperliquid permissions if present
    if (permissions.hlAllowedMarkets) {
      mapped.hlAllowedMarkets = permissions.hlAllowedMarkets;
    }
    if (typeof permissions.hlMaxUsdPerTrade === 'number') {
      mapped.hlMaxUsdPerTrade = permissions.hlMaxUsdPerTrade;
    }
    
    return mapped;
  }
}
