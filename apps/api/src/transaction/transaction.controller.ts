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

  @Get('bridge/config')
  getBridgeConfigStatus() {
    const chains = ['ethereum', 'base', 'arbitrum', 'linea'];
    const perChain = chains.map((c) => {
      const key = `AXELAR_GATEWAY_ADDRESS_${c.toUpperCase()}`;
      const addr = process.env[key];
      return { chain: c, env: key, present: Boolean(addr), address: addr ?? null };
    });
    const globals = [
      { key: 'SEI_BRIDGE_ENABLED', value: process.env.SEI_BRIDGE_ENABLED ?? null },
      { key: 'AXELAR_SEI_CHAIN_NAME', value: process.env.AXELAR_SEI_CHAIN_NAME ?? 'sei' },
      { key: 'AXELAR_TOKEN_SYMBOL_USDC', value: process.env.AXELAR_TOKEN_SYMBOL_USDC ?? 'aUSDC' },
    ];
    const ready = globals.find(g => g.key === 'SEI_BRIDGE_ENABLED')?.value === 'true' && perChain.some((p) => p.present);
    return { ready, perChain, globals };
  }

  @Get('chains')
  getSupportedChains() {
    // Executable chains are those our signer/bundler is configured for
    const executable = [
      { name: 'ethereum', capabilities: ['swap', 'bridge'], provider: 'OneBalance' },
      { name: 'base', capabilities: ['swap', 'bridge'], provider: 'OneBalance' },
      { name: 'arbitrum', capabilities: ['swap', 'bridge'], provider: 'OneBalance' },
      { name: 'linea', capabilities: ['swap', 'bridge'], provider: 'OneBalance' },
      { name: 'sei', capabilities: ['swap', 'bridge'], provider: 'Sei (swap), Axelar (bridge)' },
    ];

    // Read-only networks (aggregated balances visible via OneBalance, execution pending)
    const readOnly = [
      { name: 'avalanche', provider: 'OneBalance (balances, quote preview)' },
      { name: 'solana', provider: 'OneBalance (balances only)' },
    ];

    return { executable, readOnly };
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
