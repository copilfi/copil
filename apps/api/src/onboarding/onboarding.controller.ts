import { Controller, Get, Post, Body, Query, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { OnboardingService } from './onboarding.service';
import { TransactionService } from '../transaction/transaction.service';
import { encodeFunctionData } from 'viem';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from '@copil/database';
import { FundPlanDto, FundQuoteDto, PrepareNativeDto, PrepareErc20Dto } from './dto/onboarding.dto';
import { Throttle } from '@nestjs/throttler';

const ERC20_ABI = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [ { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' } ], outputs: [ { name: '', type: 'bool' } ] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [ { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' } ], outputs: [ { name: '', type: 'bool' } ] },
] as const;

@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly svc: OnboardingService,
    private readonly txService: TransactionService,
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
  ) {}

  @Get('addresses')
  addresses(@Request() req: AuthRequest) {
    return this.svc.getAddresses(req.user.id);
  }

  @Get('status')
  status(@Request() req: AuthRequest, @Query('chain') chain?: string) {
    return this.svc.getStatus(req.user.id, chain);
  }

  @Get('recommendation')
  recommend(@Request() req: AuthRequest, @Query('preferred') preferred?: string) {
    return this.svc.recommendChain(req.user.id, preferred);
  }

  @Post('prepare/native-transfer')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  prepareNativeTransfer(@Body() body: PrepareNativeDto) {
    return { transactionRequest: { to: body.to, value: body.valueWei, data: '0x' }, chain: body.chain };
  }

  @Post('prepare/erc20-transfer')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  prepareErc20Transfer(@Body() body: PrepareErc20Dto) {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [ body.to, BigInt(body.amount) ] });
    return { transactionRequest: { to: body.token, data, value: '0' }, chain: body.chain };
  }

  @Post('fund-plan')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async fundPlan(@Request() req: AuthRequest, @Body() body: FundPlanDto) {
    const { targetChain, safeAddress, fromChain, fromToken, fromAmount, toToken } = body;
    if (!targetChain || !safeAddress || !fromChain || !fromToken || !fromAmount) throw new BadRequestException('targetChain, safeAddress, fromChain, fromToken, fromAmount are required');
    const srcWallet = await this.walletRepo.findOne({ where: { userId: req.user.id, chain: fromChain.toLowerCase() } });
    if (!srcWallet) throw new BadRequestException(`No EOA wallet found for chain ${fromChain}. Add a wallet first.`);
    if (fromChain.toLowerCase() === targetChain.toLowerCase()) {
      // Same-chain transfer plan (EOA-signed)
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [ safeAddress, BigInt(fromAmount) ] });
      return {
        kind: 'sameChainTransfer',
        chain: fromChain,
        to: fromToken,
        transactionRequest: { to: fromToken, data, value: '0' },
        hint: 'Sign with your EOA to move funds to your Smart Account on the same chain.',
      };
    }
    // Cross-chain bridge intent (EOA-signed via provider)
    return {
      kind: 'bridgeIntent',
      intent: {
        type: 'bridge',
        fromChain,
        toChain: targetChain,
        fromToken,
        toToken: toToken ?? 'USDC',
        fromAmount,
        userAddress: srcWallet.address, // source EOA
        destinationAddress: safeAddress,
        slippageBps: 50,
      },
      hint: 'Use provider comparison to get an executable bridge transaction. Destination is your Smart Account on the target chain.',
    };
  }

  @Post('fund-quote')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async fundQuote(@Request() req: AuthRequest, @Body() body: FundQuoteDto) {
    const { targetChain, safeAddress, fromChain, fromToken, fromAmount, toToken } = body;
    if (!targetChain || !safeAddress || !fromChain || !fromToken || !fromAmount) throw new BadRequestException('targetChain, safeAddress, fromChain, fromToken, fromAmount are required');
    const srcWallet = await this.walletRepo.findOne({ where: { userId: req.user.id, chain: fromChain.toLowerCase() } });
    if (!srcWallet) throw new BadRequestException(`No EOA wallet found for chain ${fromChain}. Add a wallet first.`);
    if (fromChain.toLowerCase() === targetChain.toLowerCase()) {
      // same-chain transfer quote is trivial (prepare/erc20-transfer already covers it)
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [ safeAddress, BigInt(fromAmount) ] });
      return {
        recommendation: { provider: 'same-chain-transfer', executable: true, reason: 'No bridge required' },
        selected: { provider: 'same-chain-transfer', transactionRequest: { to: fromToken, data, value: '0' } },
      };
    }
    const intent = {
      type: 'bridge' as const,
      fromChain,
      toChain: targetChain,
      fromToken,
      toToken: toToken ?? 'USDC',
      fromAmount,
      userAddress: srcWallet.address,
      destinationAddress: safeAddress,
      slippageBps: 50,
    };
    const res = await this.txService.compareQuotes(intent);
    const provider = res.recommendation?.provider;
    let tx: any = undefined;
    if (provider === 'onebalance') {
      tx = res.onebalance.quote?.transactionRequest;
    } else if (provider === 'lifi') {
      tx = res.lifi.transactionRequest;
    }
    return { ...res, selected: tx ? { provider, transactionRequest: tx } : undefined };
  }
}
