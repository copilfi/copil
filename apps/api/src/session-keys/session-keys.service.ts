import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionKey, SessionKeyPermissions, SessionActionType } from '@copil/database';
import { Repository } from 'typeorm';
import { CreateSessionKeyDto } from './dto/create-session-key.dto';
import { UpdateSessionKeyDto } from './dto/update-session-key.dto';
import { SmartAccountOrchestratorService } from '../smart-account/smart-account.service';
import { ConfigService } from '@nestjs/config';
import { SessionKeyPermissionsDto } from './dto/permissions.dto';

@Injectable()
export class SessionKeysService {
  constructor(
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
    private readonly orchestrator: SmartAccountOrchestratorService,
    private readonly configService: ConfigService,
  ) {}

  async create(userId: number, dto: CreateSessionKeyDto): Promise<SessionKey> {
    const existing = await this.sessionKeyRepository.findOne({ where: { publicKey: dto.publicKey } });
    if (existing) {
      throw new ConflictException('Session key already registered.');
    }

    const permissions = this.mapPermissions(dto.permissions);
    if (!permissions.actions || permissions.actions.length === 0) {
      throw new BadRequestException('Session key permissions.actions must be defined.');
    }

    const sessionKey = this.sessionKeyRepository.create({
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
      if (chain) {
        void this.orchestrator.deploy(userId, saved.id, chain).catch(() => void 0);
      }
    }

    return saved;
  }

  findAll(userId: number): Promise<SessionKey[]> {
    return this.sessionKeyRepository.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async update(id: number, userId: number, dto: UpdateSessionKeyDto): Promise<SessionKey> {
    const sessionKey = await this.sessionKeyRepository.findOne({ where: { id, userId } });
    if (!sessionKey) {
      throw new NotFoundException(`Session key ${id} not found`);
    }

    if (dto.isActive !== undefined) {
      sessionKey.isActive = dto.isActive;
    }
    if (dto.expiresAt !== undefined) {
      sessionKey.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    }
    if (dto.permissions !== undefined) {
      const mapped = this.mapPermissions(dto.permissions);
      if (!mapped.actions || !mapped.actions.length) {
        throw new BadRequestException('Session key permissions.actions must be defined.');
      }
      sessionKey.permissions = mapped;
    }

    return this.sessionKeyRepository.save(sessionKey);
  }

  private mapPermissions(permissions?: SessionKeyPermissionsDto): SessionKeyPermissions {
    if (!permissions) {
      return {};
    }

    const mapped: SessionKeyPermissions = {};
    if (permissions.actions) {
      mapped.actions = permissions.actions.map((action) => action as SessionActionType);
    }
    if (permissions.chains) {
      mapped.chains = permissions.chains;
    }
    if (permissions.allowedContracts) {
      mapped.allowedContracts = permissions.allowedContracts;
    }
    if (permissions.spendLimits) {
      mapped.spendLimits = permissions.spendLimits.map((s) => ({ token: s.token, maxAmount: s.maxAmount, windowSec: s.windowSec }));
    }
    if (permissions.notes) {
      mapped.notes = permissions.notes;
    }
    // Hyperliquid policy extensions (optional)
    if (permissions.hlAllowedMarkets) {
      mapped.hlAllowedMarkets = permissions.hlAllowedMarkets;
    }
    if (typeof permissions.hlMaxUsdPerTrade === 'number') {
      mapped.hlMaxUsdPerTrade = permissions.hlMaxUsdPerTrade;
    }
    return mapped;
  }
}
