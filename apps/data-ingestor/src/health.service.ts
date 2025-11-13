import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenPrice } from '@copil/database';

@Injectable()
export class HealthService {
  constructor(
    @InjectRepository(TokenPrice)
    private readonly tokenRepo: Repository<TokenPrice>,
  ) {}

  async getStatus() {
    const latest = await this.tokenRepo.findOne({
      order: { timestamp: 'DESC' },
    });
    return {
      ok: true,
      latestIngestAt: latest?.timestamp ?? null,
    };
  }
}
