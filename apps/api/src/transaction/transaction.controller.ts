import { Controller, Post, Body, UseGuards, Get, Query, Request } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { ExecuteTransactionDto } from './dto/execute-transaction.dto';
import { GetQuoteDto } from './dto/get-quote.dto';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { Throttle } from '@nestjs/throttler';

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
  @Throttle(30, 60)
  async compareQuotes(@Body() getQuoteDto: GetQuoteDto) {
    const intent = getQuoteDto.intent;
    return this.transactionService.compareQuotes(intent);
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
    const has = (k: string) => Boolean(process.env[k]);
    const bundlerOk = has('PIMLICO_API_KEY');
    const rpc = (chain: string) => has(`RPC_URL_${chain.toUpperCase()}`);

    // Executable chains are those our signer/bundler is configured for
    const executable = [
      { name: 'ethereum', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('ethereum') },
      { name: 'base', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('base') },
      { name: 'arbitrum', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('arbitrum') },
      { name: 'linea', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('linea') },
      { name: 'optimism', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('optimism') },
      { name: 'polygon', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('polygon') },
      { name: 'bsc', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('bsc') },
      { name: 'avalanche', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('avalanche') },
      { name: 'hyperevm', capabilities: ['swap', 'bridge'], provider: 'OneBalance', ready: bundlerOk && rpc('hyperevm') },
      { name: 'sei', capabilities: ['swap', 'bridge'], provider: 'Sei (swap), Axelar (bridge)', ready: rpc('sei') },
    ];

    // Read-only networks (aggregated balances visible via OneBalance, execution pending)
    const readOnly = [
      { name: 'solana', provider: 'OneBalance (balances only)' },
    ];

    return { executable, readOnly, requirements: { bundler: 'PIMLICO_API_KEY', rpcEnv: 'RPC_URL_<CHAIN>' } };
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
