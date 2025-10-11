import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuoteRequest } from '@lifi/sdk';

@UseGuards(JwtAuthGuard)
@Controller('transaction')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('quote')
  getQuote(@Body() quoteRequest: Omit<QuoteRequest, 'integrator'>) {
    return this.transactionService.getQuote(quoteRequest);
  }
}
