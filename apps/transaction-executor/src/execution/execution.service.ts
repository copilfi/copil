import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Strategy, TransactionLog, SessionKey, SessionKeyPermissions, Wallet } from '@copil/database';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ExecutionResult, TransactionJobData } from './types';
import { SwapAggregatorClient } from '../clients/swap-aggregator.client';
import { LiFiClient } from '../clients/lifi.client';
import { SignerService } from '../signer/signer.service';
import { Job } from 'bullmq';
import { createPublicClient, http, encodeFunctionData, Chain } from 'viem';
import { mainnet, base, arbitrum, linea } from 'viem/chains';

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
    private readonly swapClient: SwapAggregatorClient,
    private readonly lifiClient: LiFiClient,
    private readonly signerService: SignerService,
    private readonly configService: ConfigService,
  ) {}

  async execute(job: TransactionJobData, queueJob?: Job<TransactionJobData>): Promise<void> {
    const jobDescription = job.strategyId
      ? `strategy ${job.strategyId}`
      : `ad-hoc job for user ${job.userId}`;
    this.logger.log(`Received job for ${jobDescription}: ${job.action.type}`);

    // If the job is tied to a strategy, validate it.
    if (job.strategyId) {
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
    }

    const sessionKeyValidation = await this.validateSessionKey(job);
    if (!sessionKeyValidation.valid) {
      await this.recordLog(job, 'failed', sessionKeyValidation.reason ?? 'Session key invalid.');
      return;
    }

    const pendingLog = await this.recordLog(
      job,
      'pending',
      `Executing ${job.action.type} action for ${jobDescription}`,
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
        this.logger.log(`Job for ${jobDescription} action completed successfully.`);
      } else if (result.status === 'skipped') {
        this.logger.warn(`Job for ${jobDescription} action skipped. ${result.description ?? ''}`);
      } else {
        this.logger.error(
          `Job for ${jobDescription} action failed. ${result.description ?? 'No details provided.'}`,
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
          `Job for ${jobDescription} action will be retried: ${message}`,
        );
      } else {
        this.logger.error(
          `Job for ${jobDescription} action threw an exception: ${message}`,
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

        // Approval flow: if ERC-20 and allowance is insufficient, submit approve first.
        let approvalTxHash: string | undefined;
        const allowanceTarget = quote.allowanceTarget;
        try {
          if (allowanceTarget && this.isErc20(job.action.assetIn)) {
            const owner = await this.getOwnerAddress(job.userId, job.action.chainId);
            if (!owner) {
              return {
                status: 'failed',
                description: `Smart account/wallet not found for user ${job.userId} on ${job.action.chainId}.`,
              };
            }

            const allowance = await this.readAllowance(
              job.action.chainId,
              job.action.assetIn as `0x${string}`,
              owner,
              allowanceTarget as `0x${string}`,
            );

            const required = BigInt(job.action.amountIn);
            if (allowance < required) {
              const approveData = encodeFunctionData({
                abi: this.erc20Abi,
                functionName: 'approve',
                args: [allowanceTarget as `0x${string}`, required],
              });

              const approveResult = await this.signerService.signAndSend({
                userId: job.userId,
                sessionKeyId: job.sessionKeyId!,
                transaction: { to: job.action.assetIn as `0x${string}`, data: approveData },
                metadata: { chain: job.action.chainId, purpose: 'approval' },
              });

              if (approveResult.status !== 'success') {
                return {
                  status: approveResult.status,
                  description: approveResult.description ?? 'Approval failed.',
                  metadata: {
                    chain: job.action.chainId,
                    allowanceTarget,
                    approval: 'failed',
                  },
                };
              }
              approvalTxHash = approveResult.txHash;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: 'failed', description: `Approval check failed: ${msg}` };
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
              approvalTxHash,
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
            approvalTxHash,
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

    const newLog = new TransactionLog();
    newLog.userId = job.userId;
    newLog.description = description;
    newLog.status = status;
    newLog.chain = chain;

    if (job.strategyId) {
      newLog.strategyId = job.strategyId;
    }

    return this.transactionLogRepository.save(newLog);
  }
  
  private isErc20(assetAddress: string): boolean {
    const lower = assetAddress?.toLowerCase();
    if (!lower) return false;
    const natives = new Set([
      'eth',
      'native',
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      '0x0000000000000000000000000000000000000000',
    ]);
    return !natives.has(lower);
  }

  private chainMap: Record<string, Chain> = {
    ethereum: mainnet,
    base,
    arbitrum,
    linea,
  };

  private getRpcUrl(chain: string): string {
    const key = `RPC_URL_${chain.toUpperCase()}`;
    const url = this.configService.get<string>(key) ?? this.configService.get<string>('RPC_URL');
    if (!url) {
      throw new Error(`RPC URL for chain ${chain} not configured.`);
    }
    return url;
  }

  private async getOwnerAddress(userId: number, chain: string): Promise<`0x${string}` | undefined> {
    const wallet = await this.walletRepository.findOne({ where: { userId, chain } });
    const address = (wallet?.smartAccountAddress ?? wallet?.address) as `0x${string}` | undefined;
    return address;
  }

  private getPublicClient(chainName: string) {
    const chain = this.chainMap[chainName.toLowerCase()];
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainName}`);
    }
    return createPublicClient({ transport: http(this.getRpcUrl(chainName)), chain });
  }

  private erc20Abi = [
    {
      type: 'function',
      name: 'allowance',
      stateMutability: 'view',
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      outputs: [{ name: '', type: 'uint256' }],
    },
    {
      type: 'function',
      name: 'approve',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    },
  ] as const;

  private async readAllowance(
    chainName: string,
    token: `0x${string}`,
    owner: `0x${string}`,
    spender: `0x${string}`,
  ): Promise<bigint> {
    const client = this.getPublicClient(chainName);
    const value = await client.readContract({
      abi: this.erc20Abi,
      address: token,
      functionName: 'allowance',
      args: [owner, spender],
    });
    return value as bigint;
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
