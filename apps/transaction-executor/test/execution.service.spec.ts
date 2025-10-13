import { ExecutionService } from '../src/execution/execution.service';
import { TransactionJobData } from '../src/execution/types';
import { Repository } from 'typeorm';
import { Strategy, TransactionLog, SessionKey } from '@copil/database';
import { SwapAggregatorClient } from '../src/clients/swap-aggregator.client';
import { LiFiClient } from '../src/clients/lifi.client';

type MockedRepository<T> = Partial<
  Record<keyof Repository<T>, jest.Mock>
> & {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
};

function createRepositoryMock<T>(): MockedRepository<T> {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
}

describe('ExecutionService', () => {
  let strategyRepository: MockedRepository<Strategy>;
  let transactionLogRepository: MockedRepository<TransactionLog>;
  let sessionKeyRepository: MockedRepository<SessionKey>;
  let swapClient: jest.Mocked<SwapAggregatorClient>;
  let lifiClient: jest.Mocked<LiFiClient>;
  let service: ExecutionService;

  beforeEach(() => {
    strategyRepository = createRepositoryMock<Strategy>();
    transactionLogRepository = createRepositoryMock<TransactionLog>();
    sessionKeyRepository = createRepositoryMock<SessionKey>();

    swapClient = {
      getQuote: jest.fn().mockResolvedValue({ supported: false, warning: 'not supported' }),
      execute: jest.fn().mockResolvedValue({
        success: false,
        description: 'not implemented',
      }),
    } as unknown as jest.Mocked<SwapAggregatorClient>;

    lifiClient = {
      getQuote: jest.fn().mockResolvedValue({ supported: false, warning: 'not supported' }),
      execute: jest.fn().mockResolvedValue({
        success: false,
        description: 'not implemented',
      }),
    } as unknown as jest.Mocked<LiFiClient>;

    transactionLogRepository.save.mockImplementation(async (entity) => ({ id: 1, ...entity }));
    transactionLogRepository.create.mockImplementation((entity) => entity as any);

    service = new ExecutionService(
      strategyRepository as unknown as Repository<Strategy>,
      transactionLogRepository as unknown as Repository<TransactionLog>,
      sessionKeyRepository as unknown as Repository<SessionKey>,
      swapClient,
      lifiClient,
    );
  });

  it('records failure when strategy cannot be found', async () => {
    strategyRepository.findOne.mockResolvedValue(null);

    const job: TransactionJobData = {
      strategyId: 42,
      userId: 7,
      action: {
        type: 'swap',
        chainId: 'base',
        assetIn: '0xIn',
        assetOut: '0xOut',
        amountIn: '1',
      },
    };

    await service.execute(job);

    expect(strategyRepository.findOne).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(transactionLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        description: 'Strategy 42 not found',
        userId: 7,
      }),
    );
    expect(transactionLogRepository.save).toHaveBeenCalledTimes(1);
    expect(swapClient.getQuote).not.toHaveBeenCalled();
  });

  it('fails when session key is missing', async () => {
    strategyRepository.findOne.mockResolvedValue({ id: 42, userId: 7 } as Strategy);

    const job: TransactionJobData = {
      strategyId: 42,
      userId: 7,
      action: {
        type: 'swap',
        chainId: 'base',
        assetIn: '0xIn',
        assetOut: '0xOut',
        amountIn: '1',
      },
    };

    await service.execute(job);

    expect(transactionLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        description: 'Session key is required for transaction execution.',
      }),
    );
    expect(swapClient.getQuote).not.toHaveBeenCalled();
  });

  it('fails when session key action is not permitted', async () => {
    strategyRepository.findOne.mockResolvedValue({ id: 5, userId: 2 } as Strategy);
    sessionKeyRepository.findOne.mockResolvedValue({
      id: 9,
      userId: 2,
      isActive: true,
      expiresAt: null,
      permissions: { actions: ['bridge'] },
    } as SessionKey);

    const job: TransactionJobData = {
      strategyId: 5,
      userId: 2,
      sessionKeyId: 9,
      action: {
        type: 'swap',
        chainId: 'base',
        assetIn: '0xIn',
        assetOut: '0xOut',
        amountIn: '1',
      },
    };

    await service.execute(job);

    expect(transactionLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        description: 'Session key 9 does not permit swap actions.',
      }),
    );
    expect(swapClient.getQuote).not.toHaveBeenCalled();
  });
});
