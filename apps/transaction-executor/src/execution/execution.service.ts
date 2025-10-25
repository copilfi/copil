import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Strategy, TransactionLog, SessionKey, SessionKeyPermissions, Wallet } from '@copil/database';
import { Repository, MoreThan } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ExecutionResult, TransactionJobData } from './types';
import { SignerService } from '../signer/signer.service';
import { Job } from 'bullmq';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';

class RetryableExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableExecutionError';
  }
}

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    private readonly signerService: SignerService,
    private readonly chainAbstractionClient: ChainAbstractionClient, // Injected the new client
  ) {}

  async execute(job: TransactionJobData, queueJob?: Job<TransactionJobData>): Promise<void> {
    const jobDescription = job.strategyId
      ? `strategy ${job.strategyId}`
      : `ad-hoc job for user ${job.userId}`;
    this.logger.log(`Received job for ${jobDescription}: ${job.intent.type}`);

    // Validation logic remains largely the same
    if (job.strategyId) {
      const strategy = await this.strategyRepository.findOne({ where: { id: job.strategyId } });
      if (!strategy) {
        await this.recordLog(job, 'failed', `Strategy ${job.strategyId} not found`);
        return;
      }
    }

    const sessionKeyValidation = await this.validateSessionKey(job);
    if (!sessionKeyValidation.valid) {
      await this.recordLog(job, 'failed', sessionKeyValidation.reason ?? 'Session key invalid.');
      return;
    }

    const pendingLog = await this.recordLog(
      job,
      'pending',
      `Executing ${job.intent.type} action for ${jobDescription}`,
    );

    try {
      // The new, simplified execution flow
      const result = await this.executeTransaction(job);

      const updateParams: QueryDeepPartialEntity<TransactionLog> = {
        status: result.status,
        description: result.description ?? pendingLog.description,
        txHash: result.txHash,
        ...(result.metadata ? { details: result.metadata as any } : {}),
      };

      await this.transactionLogRepository.update({ id: pendingLog.id }, updateParams);

      if (result.status === 'success') {
        this.logger.log(`Job for ${jobDescription} action completed successfully.`);
        try {
          if (job.sessionKeyId) {
            const sk = await this.sessionKeyRepository.findOne({ where: { id: job.sessionKeyId } });
            if (sk) {
              // Touch record to bump updatedAt; usage telemetry fields can be added via migration later
              await this.sessionKeyRepository.save(sk);
            }
          }
        } catch {}
      } else {
        this.logger.error(
          `Job for ${jobDescription} action failed. ${result.description ?? 'No details provided.'}`,
        );
      }

    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred during execution.';
      this.logger.error(
        `Job for ${jobDescription} action threw an exception: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.transactionLogRepository.update(pendingLog.id, {
        status: 'failed',
        description: message,
      });

      throw error;
    }
  }

  private async executeTransaction(job: TransactionJobData): Promise<ExecutionResult> {
    const { intent, userId, sessionKeyId } = job;

    // Hyperliquid intents are executed directly by the signer service without a quote
    if (intent.type === 'open_position' || intent.type === 'close_position') {
      const wallet = await this.walletRepository.findOne({ where: { userId, chain: 'hyperliquid' } })
        .catch(() => null);
      // Provide a lightweight fallback wallet; signer derives the actual HL address from session key
      const fallback: any = wallet ?? { userId, chain: 'hyperliquid', address: '0x0000000000000000000000000000000000000000', type: 'eoa' };
      return this.signerService.signAndSend({
        userId,
        sessionKeyId,
        wallet: fallback,
        metadata: { intent },
      });
    }

    const { quote } = job as any;
    if (!quote?.transactionRequest && !quote?.serializedTx) {
      return { status: 'failed', description: 'No transactionRequest or serializedTx found in the job payload from the quote.' };
    }

    let chainName: string;
    if (intent.type === 'swap' || intent.type === 'bridge') {
      chainName = intent.fromChain;
    } else if (intent.type === 'transfer') {
      chainName = intent.chain;
    } else {
      chainName = (job.metadata as any)?.chain;
    }

    const wallet = await this.walletRepository.findOne({ where: { userId: job.userId, chain: chainName } });
    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${job.userId} on chain ${chainName} not found.`);
    }

    // Enforce session key on-chain-like policy at app layer (defense-in-depth)
    const sessionKey = await this.sessionKeyRepository.findOne({ where: { id: job.sessionKeyId! } });
    const perms = sessionKey?.permissions as SessionKeyPermissions | undefined;

    // allowedContracts: the destination contract of main tx (and optional approval tx) must be whitelisted if provided
    if (perms?.allowedContracts?.length) {
      const allowed = new Set(perms.allowedContracts.map((a) => a.toLowerCase()));
      const mainToOk = typeof quote.transactionRequest?.to === 'string' && allowed.has((quote.transactionRequest.to as string).toLowerCase());
      const approvalToOk = !quote.approvalTransactionRequest || (typeof quote.approvalTransactionRequest?.to === 'string' && allowed.has((quote.approvalTransactionRequest.to as string).toLowerCase()));
      if (!mainToOk || !approvalToOk) {
        return {
          status: 'failed',
          description: 'Destination contract not permitted by session key policy.',
          metadata: { to: quote.transactionRequest?.to, approvalTo: quote.approvalTransactionRequest?.to },
        };
      }
    }

    // spendLimits: simple per-transaction cap by source token
    if (perms?.spendLimits?.length) {
      const limits = perms.spendLimits;
      const token = (job.intent as any)?.fromToken as string | undefined;
      const amount = (job.intent as any)?.fromAmount as string | undefined;
      if (token && amount) {
        const lim = limits.find((l) => l.token.toLowerCase() === token.toLowerCase());
        if (lim) {
          try {
            const amt = BigInt(amount);
            const cap = BigInt(lim.maxAmount);
            if (amt > cap) {
              return { status: 'failed', description: 'Requested amount exceeds session key spend limit.', metadata: { token, amount, cap: lim.maxAmount } };
            }
          } catch {
            // If parsing fails, fail closed
            return { status: 'failed', description: 'Invalid amount or spend limit in policy.', metadata: { token, amount, limit: lim.maxAmount } };
          }
        }
      }
    }

    // Optional approval step first
    if (quote.approvalTransactionRequest) {
      // EOA wallets may also need approvals for token spending
      const approveRes = await this.signerService.signAndSend({
        userId: job.userId,
        sessionKeyId: job.sessionKeyId!,
        transaction: quote.approvalTransactionRequest,
        wallet: wallet, // Pass wallet context
        metadata: { intent: job.intent, quoteId: quote.id, purpose: 'approval', chain: chainName },
      });
      if (approveRes.status !== 'success') {
        return {
          status: approveRes.status,
          description: approveRes.description ?? 'Approval transaction failed or was skipped.',
          metadata: { quoteId: quote.id, intent: job.intent },
        };
      }
    }

    const signerResult = await this.signerService.signAndSend({
      userId: job.userId,
      sessionKeyId: job.sessionKeyId!,
      transaction: quote.transactionRequest, // This will be null for Solana, handled by signerService
      wallet: wallet, // Pass wallet context
      metadata: { intent: job.intent, quote: quote, chain: chainName }, // include chain for EOA/Sol
    });

    return {
      status: signerResult.status,
      txHash: signerResult.txHash,
      description: signerResult.description,
      metadata: { quoteId: quote.id, intent: job.intent },
    };
  }
  // ... (recordLog, validateSessionKey, etc. remain the same)

  private async recordLog(
    job: TransactionJobData,
    status: string,
    description: string,
  ): Promise<TransactionLog> {
    let chain: string | undefined;
    if (job.intent.type === 'swap' || job.intent.type === 'bridge') {
      chain = job.intent.fromChain;
    } else if (job.intent.type === 'transfer') {
      chain = job.intent.chain;
    } else if (job.intent.type === 'open_position' || job.intent.type === 'close_position') {
      chain = (job.intent as any).chain ?? 'hyperliquid';
    }

    const newLog = new TransactionLog();
    newLog.userId = job.userId;
    newLog.description = description;
    newLog.status = status;
    newLog.chain = chain; // Can be undefined for custom intents
    try {
      (newLog as any).details = { intent: job.intent, ...(job as any).metadata };
    } catch {}

    if (job.strategyId) {
      newLog.strategyId = job.strategyId;
    }

    return this.transactionLogRepository.save(newLog);
  }

  private async validateSessionKey(job: TransactionJobData): Promise<{ valid: boolean; reason?: string }> {
    if (!job.sessionKeyId) {
      return {
        valid: false,
        reason: 'Session key is required for transaction execution.',
      };
    }

    const sessionKey = await this.sessionKeyRepository.findOne({ where: { id: job.sessionKeyId } });

    if (!sessionKey) {
      return { valid: false, reason: `Session key ${job.sessionKeyId} not found.` };
    }

    if (sessionKey.userId !== job.userId) {
      return {
        valid: false,
        reason: `Session key ${sessionKey.id} does not belong to user ${job.userId}.`,
      };
    }

    if (!sessionKey.isActive) {
      return { valid: false, reason: `Session key ${sessionKey.id} is inactive.` };
    }

    if (sessionKey.expiresAt && sessionKey.expiresAt.getTime() < Date.now()) {
      return { valid: false, reason: `Session key ${sessionKey.id} has expired.` };
    }

    const permissions = sessionKey.permissions as SessionKeyPermissions | undefined;
    if (permissions?.actions?.length && !permissions.actions.includes(job.intent.type)) {
      return {
        valid: false,
        reason: `Session key ${sessionKey.id} does not permit ${job.intent.type} actions.`,
      };
    }

    if (permissions?.chains?.length) {
      if (job.intent.type === 'swap' || job.intent.type === 'bridge') {
        const chains = new Set(permissions.chains.map((chain) => chain.toLowerCase()));
        const checkChain = (chain?: string) => !chain || chains.has(chain.toLowerCase());
        const chainAllowed = checkChain(job.intent.fromChain) && checkChain(job.intent.toChain);

        if (!chainAllowed) {
          return {
            valid: false,
            reason: `Session key ${sessionKey.id} does not allow the requested chain(s).`,
          };
        }
      }
    }

    // Windowed spend limits: sum of successful executions within windowSec + current intent must not exceed cap
    if (permissions?.spendLimits?.length && (job.intent.type === 'swap' || job.intent.type === 'bridge')) {
      const token = (job.intent as any)?.fromToken as string | undefined;
      const amountStr = (job.intent as any)?.fromAmount as string | undefined;
      if (token && amountStr) {
        const limit = permissions.spendLimits.find((l) => l.token.toLowerCase() === token.toLowerCase());
        if (limit && typeof limit.windowSec === 'number' && limit.windowSec > 0) {
          const since = new Date(Date.now() - limit.windowSec * 1000);
          const logs = await this.transactionLogRepository.find({
            where: { userId: job.userId, status: 'success', createdAt: MoreThan(since) },
            order: { createdAt: 'DESC' },
          });
          let spent = 0n;
          for (const l of logs) {
            const intent = (l.details as any)?.intent;
            const t = intent?.fromToken as string | undefined;
            const a = intent?.fromAmount as string | undefined;
            if (t && a && t.toLowerCase() === token.toLowerCase()) {
              try { spent += BigInt(a); } catch { /* ignore malformed */ }
            }
          }
          try {
            const nextTotal = spent + BigInt(amountStr);
            const cap = BigInt(limit.maxAmount);
            if (nextTotal > cap) {
              return {
                valid: false,
                reason: `Session key ${sessionKey.id} exceeds windowed spend limit for token ${token}. Used: ${spent.toString()}, new: ${amountStr}, cap: ${limit.maxAmount}`,
              };
            }
          } catch {
            return { valid: false, reason: 'Invalid amount or spend limit while enforcing windowed policy.' };
          }
        }
      }
    }

    return { valid: true };
  }
}
