import { Controller, Get, Delete, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMemory } from '@copil/database';

@UseGuards(JwtAuthGuard)
@Controller('chat/memory')
export class ChatMemoryController {
  constructor(@InjectRepository(ChatMemory) private readonly repo: Repository<ChatMemory>) {}

  @Get()
  async get(@Request() req: AuthRequest) {
    const rec = await this.repo.findOne({ where: { userId: req.user.id } });
    if (!rec) return { summary: null, updatedAt: null };
    return { summary: rec.summary, updatedAt: rec.updatedAt };
  }

  @Delete()
  async clear(@Request() req: AuthRequest) {
    const rec = await this.repo.findOne({ where: { userId: req.user.id } });
    if (!rec) return { ok: true };
    await this.repo.remove(rec);
    return { ok: true };
  }
}

