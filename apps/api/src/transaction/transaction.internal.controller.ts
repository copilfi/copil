import { Controller, Post, Body, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { ServiceTokenGuard } from '../auth/service-token.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy, SessionKey } from '@copil/database';

@UseGuards(ServiceTokenGuard)
@Controller('transaction')
export class TransactionInternalController {
  constructor(
    private readonly transactionService: TransactionService,
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
  ) {}

  @Post('execute/internal')
  async executeInternal(
    @Body() body: { userId: number; sessionKeyId: string; intent: any; idempotencyKey?: string; strategyId?: number },
  ) {
    const { userId, sessionKeyId, strategyId } = body;

    // Validate session key ownership
    const sessionKey = await this.sessionKeyRepository.findOne({ 
      where: { id: sessionKeyId, userId, isActive: true } 
    });
    if (!sessionKey) {
      throw new NotFoundException(`Session key ${sessionKeyId} not found or not owned by user ${userId}`);
    }

    // Validate strategy ownership if provided
    if (strategyId) {
      const strategy = await this.strategyRepository.findOne({ 
        where: { id: strategyId, userId } 
      });
      if (!strategy) {
        throw new NotFoundException(`Strategy ${strategyId} not found or not owned by user ${userId}`);
      }
    }

    return this.transactionService.createAdHocTransactionJob(
      userId,
      sessionKeyId,
      body.intent,
      body.idempotencyKey,
    );
  }
}

