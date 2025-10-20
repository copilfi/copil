import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { ServiceTokenGuard } from '../auth/service-token.guard';

@UseGuards(ServiceTokenGuard)
@Controller('transaction')
export class TransactionInternalController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('execute/internal')
  async executeInternal(
    @Body() body: { userId: number; sessionKeyId: number; intent: any; idempotencyKey?: string },
  ) {
    return this.transactionService.createAdHocTransactionJob(
      body.userId,
      body.sessionKeyId,
      body.intent,
      body.idempotencyKey,
    );
  }
}

