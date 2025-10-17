import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Strategy, TransactionLog, SessionKey, SessionKeyPermissions } from '@copil/database';
import { Repository } from 'typeorm';
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
    // The complex dispatch logic is replaced by this simpler flow.
    // The quote and transactionRequest are already in the job payload.
    const { quote } = job;

    if (!quote?.transactionRequest) {
      return {
        status: 'failed',
        description: 'No transactionRequest found in the job payload from the quote.',
      };
    }

    // The signer service is now responsible for all signing and broadcasting.
    const signerResult = await this.signerService.signAndSend({
      userId: job.userId,
      sessionKeyId: job.sessionKeyId!,
      transaction: quote.transactionRequest, // Pass the request from the quote
      metadata: { intent: job.intent, quoteId: quote.id },
    });

    return {
      status: signerResult.status,
      txHash: signerResult.txHash,
      description: signerResult.description,
      metadata: { quoteId: quote.id, intent: job.intent },
    };
  }

  private async recordLog(
    job: TransactionJobData,
    status: string,
    description: string,
  ): Promise<TransactionLog> {
    let chain: string | undefined;
    if (job.intent.type === 'swap' || job.intent.type === 'bridge') {
      chain = job.intent.fromChain;
    }

    const newLog = new TransactionLog();
    newLog.userId = job.userId;
    newLog.description = description;
    newLog.status = status;
    newLog.chain = chain; // Can be undefined for custom intents

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

    return { valid: true };
  }
}
