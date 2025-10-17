import { Controller, Post, Body, UseGuards, Get, Query, Request } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { ExecuteTransactionDto } from './dto/execute-transaction.dto';
import { GetQuoteDto } from './dto/get-quote.dto';

@UseGuards(JwtAuthGuard)
@Controller('transaction')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('quote')
  getQuote(@Body() getQuoteDto: GetQuoteDto) {
    return this.transactionService.getQuote(getQuoteDto.intent);
  }

  @Post('execute')
  executeAdHocTransaction(
    @Request() req: AuthRequest,
    @Body() executeDto: ExecuteTransactionDto,
  ) {
    return this.transactionService.createAdHocTransactionJob(
      req.user.id,
      executeDto.sessionKeyId,
      executeDto.intent,
    );
  }

  @Get('logs')
  getLogs(@Request() req: AuthRequest, @Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.transactionService.getLogs(req.user.id, parsedLimit);
  }
}