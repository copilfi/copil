import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionKey, SessionKeyPermissions, SessionActionType } from '@copil/database';
import { Repository } from 'typeorm';
import { CreateSessionKeyDto } from './dto/create-session-key.dto';
import { UpdateSessionKeyDto } from './dto/update-session-key.dto';

@Injectable()
export class SessionKeysService {
  constructor(
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
  ) {}

  async create(userId: number, dto: CreateSessionKeyDto): Promise<SessionKey> {
    const existing = await this.sessionKeyRepository.findOne({ where: { publicKey: dto.publicKey } });
    if (existing) {
      throw new ConflictException('Session key already registered.');
    }

    const sessionKey = this.sessionKeyRepository.create({
      userId,
      publicKey: dto.publicKey,
      permissions: this.mapPermissions(dto.permissions),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      isActive: dto.isActive ?? true,
    });

    return this.sessionKeyRepository.save(sessionKey);
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
      sessionKey.permissions = this.mapPermissions(dto.permissions);
    }

    return this.sessionKeyRepository.save(sessionKey);
  }

  private mapPermissions(permissions?: { actions?: string[]; chains?: string[]; notes?: string }): SessionKeyPermissions {
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
    if (permissions.notes) {
      mapped.notes = permissions.notes;
    }
    return mapped;
  }
}
