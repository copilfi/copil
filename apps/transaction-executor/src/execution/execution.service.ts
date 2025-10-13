import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Strategy, TransactionLog, SessionKey } from '@copil/database';
import { Repository } from 'typeorm';
import { ExecutionResult, TransactionJobData } from './types';
import { SwapAggregatorClient } from '../clients/swap-aggregator.client';
import { LiFiClient } from '../clients/lifi.client';

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
  ) {}

  async execute(job: TransactionJobData): Promise<void> {
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
      await this.recordLog(job, 'failed', sessionKeyValidation.reason);
      return;
    }

    const pendingLog = await this.recordLog(
      job,
      'pending',
      `Executing ${job.action.type} action for strategy ${job.strategyId}`,
    );

    try {
      const result = await this.dispatch(job);

      await this.transactionLogRepository.update(pendingLog.id, {
        status: result.status,
        description: result.description ?? pendingLog.description,
        txHash: result.txHash,
      });

      if (result.status === 'success') {
        this.logger.log(`Strategy ${job.strategyId} action completed successfully.`);
      } else if (result.status === 'skipped') {
        this.logger.warn(`Strategy ${job.strategyId} action skipped. ${result.description ?? ''}`);
      } else {
        this.logger.error(
          `Strategy ${job.strategyId} action failed. ${result.description ?? 'No details provided.'}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred during execution.';
      this.logger.error(
        `Strategy ${job.strategyId} action threw an exception: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.transactionLogRepository.update(pendingLog.id, {
        status: 'failed',
        description: message,
      });

      throw error;
    }
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

        return swapResult.success
          ? {
              status: 'success',
              description: swapResult.description,
              txHash: swapResult.txHash,
            }
          : {
              status: 'failed',
              description:
                swapResult.description ?? 'Swap execution failed without additional details.',
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

        return bridgeResult.success
          ? {
              status: 'success',
              description: bridgeResult.description,
              txHash: bridgeResult.txHash,
            }
          : {
              status: 'failed',
              description:
                bridgeResult.description ?? 'Bridge execution failed without additional details.',
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

    // TODO: evaluate permissions against job.action & metadata once defined.

    return { valid: true };
  }
}
