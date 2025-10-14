import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Strategy, TransactionLog, SessionKey, SessionKeyPermissions } from '@copil/database';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ExecutionResult, TransactionJobData } from './types';
import { SwapAggregatorClient } from '../clients/swap-aggregator.client';
import { LiFiClient } from '../clients/lifi.client';
import { SignerService } from '../signer/signer.service';
import { Job } from 'bullmq';

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
    private readonly swapClient: SwapAggregatorClient,
    private readonly lifiClient: LiFiClient,
    private readonly signerService: SignerService,
  ) {}

  async execute(job: TransactionJobData, queueJob?: Job<TransactionJobData>): Promise<void> {
    this.logger.log(`Received job for strategy ${job.strategyId}: ${job.action.type}`);

    const strategy = await this.strategyRepository.findOne({ where: { id: job.strategyId } });

    if (!strategy) {
      this.logger.warn(`Strategy ${job.strategyId} not found. Aborting execution.`);
      await this.recordLog(job, 'failed', `Strategy ${job.strategyId} not found`);
      return;
    }

    if (strategy.userId !== job.userId) {
      this.logger.warn(
        `Strategy ${job.strategyId} does not belong to user ${job.userId}. Aborting execution.`,
      );
      await this.recordLog(
        job,
        'failed',
        `Strategy ${job.strategyId} does not belong to user ${job.userId}`,
      );
      return;
    }

    const sessionKeyValidation = await this.validateSessionKey(job);
    if (!sessionKeyValidation.valid) {
      await this.recordLog(job, 'failed', sessionKeyValidation.reason ?? 'Session key invalid.');
      return;
    }

    const pendingLog = await this.recordLog(
      job,
      'pending',
      `Executing ${job.action.type} action for strategy ${job.strategyId}`,
    );

    let shouldRetry = false;
    let retryMessage: string | undefined;

    try {
      const result = await this.dispatch(job);

      if (result.transactionRequest) {
        const signerResult = await this.signerService.signAndSend({
          userId: job.userId,
          sessionKeyId: job.sessionKeyId!,
          transaction: result.transactionRequest,
          metadata: result.metadata,
        });

        if (signerResult.status === 'success') {
          result.status = 'success';
          result.txHash = signerResult.txHash;
          result.description = signerResult.description ?? result.description;
        } else if (signerResult.status === 'pending') {
          result.status = 'skipped';
          result.description = signerResult.description ?? result.description;
        } else {
          result.status = 'failed';
          result.description = signerResult.description ?? 'Signer failed to broadcast transaction.';
        }

        if (signerResult.status !== 'success' && queueJob) {
          const assessment = this.evaluateRetry(queueJob, signerResult.description ?? result.description ?? 'Signer error');
          if (assessment.shouldRetry) {
            shouldRetry = true;
            retryMessage = assessment.reason;
          }
        }
      }

      const updateParams: QueryDeepPartialEntity<TransactionLog> = {
        status: result.status,
        description: result.description ?? pendingLog.description,
        txHash: result.txHash,
        ...(result.metadata ? { details: result.metadata as any } : {}),
      };

      await this.transactionLogRepository.update({ id: pendingLog.id }, updateParams);

      if (result.status === 'success') {
        this.logger.log(`Strategy ${job.strategyId} action completed successfully.`);
      } else if (result.status === 'skipped') {
        this.logger.warn(`Strategy ${job.strategyId} action skipped. ${result.description ?? ''}`);
      } else {
        this.logger.error(
          `Strategy ${job.strategyId} action failed. ${result.description ?? 'No details provided.'}`,
        );
      }

      if (shouldRetry) {
        throw new RetryableExecutionError(retryMessage ?? 'Retrying transaction job after external dependency signaled a transient error.');
      }
    } catch (error) {
      const isRetryable = error instanceof RetryableExecutionError;
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred during execution.';
      if (isRetryable) {
        this.logger.warn(
          `Strategy ${job.strategyId} action will be retried: ${message}`,
        );
      } else {
        this.logger.error(
          `Strategy ${job.strategyId} action threw an exception: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );

        await this.transactionLogRepository.update(pendingLog.id, {
          status: 'failed',
          description: message,
        });
      }

      throw error;
    }
  }

  private evaluateRetry(job: Job<TransactionJobData>, reason: string): { shouldRetry: boolean; reason: string } {
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts.attempts ?? 0;

    if (maxAttempts > 0 && attemptsMade >= maxAttempts - 1) {
      this.logger.error(
        `Job ${job.id} reached the maximum retry attempts (${maxAttempts}). Reason: ${reason}`,
      );
      return { shouldRetry: false, reason };
    }

    const nextAttempt = attemptsMade + 1;
    const attemptInfo = maxAttempts > 0 ? `${nextAttempt}/${maxAttempts}` : `${nextAttempt}`;
    this.logger.warn(
      `Retrying job ${job.id} (attempt ${attemptInfo}). Reason: ${reason}`,
    );
    return { shouldRetry: true, reason };
  }

  private async dispatch(job: TransactionJobData): Promise<ExecutionResult> {
    switch (job.action.type) {
      case 'swap': {
        const quote = await this.swapClient.getQuote({
          chainId: job.action.chainId,
          assetIn: job.action.assetIn,
          assetOut: job.action.assetOut,
          amountIn: job.action.amountIn,
          slippageBps: job.action.slippageBps,
        });
        if (!quote.supported) {
          return {
            status: 'failed',
            description: quote.warning ?? 'Swap route not supported yet.',
          };
        }

        const swapResult = await this.swapClient.execute({
          chainId: job.action.chainId,
          assetIn: job.action.assetIn,
          assetOut: job.action.assetOut,
          amountIn: job.action.amountIn,
          slippageBps: job.action.slippageBps,
        });

        const failureStatus = swapResult.transactionRequest ? 'skipped' : 'failed';
        if (swapResult.success) {
          return {
            status: 'success',
            description: swapResult.description,
            txHash: swapResult.txHash,
            transactionRequest: swapResult.transactionRequest,
            metadata: {
              chain: job.action.chainId,
              transactionRequest: swapResult.transactionRequest,
              allowanceTarget: swapResult.allowanceTarget,
              rawQuote: swapResult.rawQuote,
            },
          };
        }
        return {
          status: failureStatus,
          description:
            swapResult.description ?? 'Swap execution failed without additional details.',
          transactionRequest: swapResult.transactionRequest,
          metadata: {
            chain: job.action.chainId,
            transactionRequest: swapResult.transactionRequest,
            allowanceTarget: swapResult.allowanceTarget,
            rawQuote: swapResult.rawQuote,
          },
        };
      }
      case 'bridge': {
        const quote = await this.lifiClient.getQuote({
          fromChainId: job.action.fromChainId,
          toChainId: job.action.toChainId,
          assetIn: job.action.assetIn,
          assetOut: job.action.assetOut,
          amountIn: job.action.amountIn,
          slippageBps: job.action.slippageBps,
        });
        if (!quote.supported) {
          return {
            status: 'failed',
            description: quote.warning ?? 'Bridge route not supported yet.',
          };
        }

        const bridgeResult = await this.lifiClient.execute({
          fromChainId: job.action.fromChainId,
          toChainId: job.action.toChainId,
          assetIn: job.action.assetIn,
          assetOut: job.action.assetOut,
          amountIn: job.action.amountIn,
          slippageBps: job.action.slippageBps,
        });

        const failureStatus = bridgeResult.transactionRequest ? 'skipped' : 'failed';
        if (bridgeResult.success) {
          return {
            status: 'success',
            description: bridgeResult.description,
            txHash: bridgeResult.txHash,
            transactionRequest: bridgeResult.transactionRequest,
            metadata: {
              chain: job.action.fromChainId,
              transactionRequest: bridgeResult.transactionRequest,
              rawQuote: bridgeResult.rawQuote,
            },
          };
        }
        return {
          status: failureStatus,
          description:
            bridgeResult.description ?? 'Bridge execution failed without additional details.',
          transactionRequest: bridgeResult.transactionRequest,
          metadata: {
            chain: job.action.fromChainId,
            transactionRequest: bridgeResult.transactionRequest,
            rawQuote: bridgeResult.rawQuote,
          },
        };
      }
      case 'custom':
        return {
          status: 'skipped',
          description: `Custom action "${job.action.name}" is currently ignored.`,
        };
      default: {
        const exhaustive: never = job.action;
        return {
          status: 'failed',
          description: `Unsupported action type ${(exhaustive as any)?.type ?? 'unknown'}.`,
        };
      }
    }
  }

  private async recordLog(
    job: TransactionJobData,
    status: string,
    description: string,
  ): Promise<TransactionLog> {
    const chain =
      job.action.type === 'bridge'
        ? job.action.toChainId
        : job.action.type === 'swap'
          ? job.action.chainId
          : undefined;

    const record = this.transactionLogRepository.create({
      userId: job.userId,
      strategyId: job.strategyId,
      description,
      status,
      chain,
    });

    return this.transactionLogRepository.save(record);
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
    if (permissions?.actions?.length && !permissions.actions.includes(job.action.type)) {
      return {
        valid: false,
        reason: `Session key ${sessionKey.id} does not permit ${job.action.type} actions.`,
      };
    }

    if (permissions?.chains?.length) {
      const chains = new Set(permissions.chains.map((chain) => chain.toLowerCase()));
      const checkChain = (chain?: string) => !chain || chains.has(chain.toLowerCase());
      const chainAllowed =
        job.action.type === 'bridge'
          ? checkChain(job.action.fromChainId) && checkChain(job.action.toChainId)
          : job.action.type === 'swap'
            ? checkChain(job.action.chainId)
            : true;
      if (!chainAllowed) {
        return {
          valid: false,
          reason: `Session key ${sessionKey.id} does not allow the requested chain(s).`,
        };
      }
    }

    return { valid: true };
  }
}
