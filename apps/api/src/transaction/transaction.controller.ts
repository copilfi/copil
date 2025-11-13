import { Controller, Post, Body, UseGuards, Get, Query, Request, Headers } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { ExecuteTransactionDto } from './dto/execute-transaction.dto';
import { GetQuoteDto } from './dto/get-quote.dto';
import { PrepareTransferDto } from './dto/prepare-transfer.dto';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';
import { Throttle } from '@nestjs/throttler';

@UseGuards(JwtAuthGuard)
@Controller('transaction')
export class TransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly chainClient: ChainAbstractionClient,
  ) {}

  @Post('prepare/transfer')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  prepareTransfer(@Body() dto: PrepareTransferDto, @Request() req: AuthRequest) {
    const intent: any = {
      type: 'transfer',
      chain: dto.chain,
      tokenAddress: dto.tokenAddress,
      fromAddress: dto.fromAddress,
      toAddress: dto.toAddress,
      amount: dto.amount,
    };
    return this.chainClient.prepareTransfer(intent);
  }

  @Post('quote')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  getQuote(@Body() getQuoteDto: GetQuoteDto) {
    return this.transactionService.getQuote(getQuoteDto.intent);
  }

  @Post('quote/providers')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
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
      { key: 'AXELAR_ESTIMATED_FEE_BPS', value: process.env.AXELAR_ESTIMATED_FEE_BPS ?? '35' },
    ];
    const problems: string[] = [];
    if (process.env.SEI_BRIDGE_ENABLED !== 'true') problems.push('SEI_BRIDGE_ENABLED must be true.');
    if (!perChain.some((p) => p.present)) problems.push('At least one AXELAR_GATEWAY_ADDRESS_<CHAIN> must be set.');
    const ready = problems.length === 0;
    const notes = [
      'toAmount for Axelar bridge is an estimate. Actual amount depends on bridge fees and execution.',
      'Configure AXELAR_ESTIMATED_FEE_BPS to adjust estimation (default 35 bps).',
    ];
    return { ready, perChain, globals, problems, notes };
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
      { name: 'sei', capabilities: ['swap', 'bridge'], provider: 'Sei (swap), Axelar (bridge)', ready: rpc('sei') },
    ];

    // Read-only networks (aggregated balances visible via OneBalance, execution pending)
    const readOnly = [
      { name: 'solana', provider: 'OneBalance (balances only)' },
    ];

    return { executable, readOnly, requirements: { bundler: 'PIMLICO_API_KEY', rpcEnv: 'RPC_URL_<CHAIN>' } };
  }

  @Post('execute')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  executeAdHocTransaction(
    @Request() req: AuthRequest,
    @Body() executeDto: ExecuteTransactionDto,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    const idempotencyKey = executeDto.idempotencyKey || idemKey || undefined;
    return this.transactionService.createAdHocTransactionJob(
      req.user.id,
      String(executeDto.sessionKeyId),
      executeDto.intent,
      idempotencyKey,
    );
  }


  @Get('logs')
  getLogs(@Request() req: AuthRequest, @Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.transactionService.getLogs(req.user.id, parsedLimit);
  }
}
