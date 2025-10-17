import { Controller, Post, Body, UseGuards, Get, Query, Request } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { ExecuteTransactionDto } from './dto/execute-transaction.dto';
import { GetQuoteDto } from './dto/get-quote.dto';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';

@UseGuards(JwtAuthGuard)
@Controller('transaction')
export class TransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly chainClient: ChainAbstractionClient,
  ) {}

  @Post('quote')
  getQuote(@Body() getQuoteDto: GetQuoteDto) {
    return this.transactionService.getQuote(getQuoteDto.intent);
  }

  @Post('quote/providers')
  async compareQuotes(@Body() getQuoteDto: GetQuoteDto) {
    const intent = getQuoteDto.intent;
    const ob = await this.transactionService.getQuote(intent).then((q) => ({ supported: true, quote: q })).catch((e) => ({ supported: false, error: (e as Error).message }));
    const lifi = await this.chainClient.getLiFiQuoteForIntent(intent);
    return { onebalance: ob, lifi };
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
