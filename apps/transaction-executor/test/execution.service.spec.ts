import { ExecutionService } from '../src/execution/execution.service';
import { TransactionJobData } from '../src/execution/types';
import { Repository } from 'typeorm';
import { Strategy, TransactionLog, SessionKey } from '@copil/database';
import { SignerService } from '../src/signer/signer.service';
import { ChainAbstractionClient } from '@copil/chain-abstraction-client';

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
  let signerService: jest.Mocked<SignerService>;
  let chainAbstractionClient: jest.Mocked<ChainAbstractionClient>;
  let service: ExecutionService;

  beforeEach(() => {
    strategyRepository = createRepositoryMock<Strategy>();
    transactionLogRepository = createRepositoryMock<TransactionLog>();
    sessionKeyRepository = createRepositoryMock<SessionKey>();
    chainAbstractionClient = {
      getQuote: jest.fn(),
      getAggregatedBalance: jest.fn(),
    } as unknown as jest.Mocked<ChainAbstractionClient>;

    signerService = {
      signAndSend: jest.fn().mockResolvedValue({ status: 'pending', description: 'Pending signer' }),
    } as unknown as jest.Mocked<SignerService>;

    transactionLogRepository.save.mockImplementation(async (entity) => ({ id: 1, ...entity }));
    transactionLogRepository.create.mockImplementation((entity) => entity as any);

    service = new ExecutionService(
      strategyRepository as unknown as Repository<Strategy>,
      transactionLogRepository as unknown as Repository<TransactionLog>,
      sessionKeyRepository as unknown as Repository<SessionKey>,
      signerService,
      chainAbstractionClient,
    );
  });

  it('records failure when strategy cannot be found', async () => {
    strategyRepository.findOne.mockResolvedValue(null);

    const job: TransactionJobData = {
      strategyId: 42,
      userId: 7,
      sessionKeyId: 1,
      intent: { type: 'swap', fromChain: 'base', toChain: 'base', fromToken: '0xIn', toToken: '0xOut', fromAmount: '1', userAddress: '0xuser' },
      quote: { id: 'q', transactionRequest: { to: '0xdead', data: '0xbeef' }, fromAmount: '1', toAmount: '1' },
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
    expect(signerService.signAndSend).not.toHaveBeenCalled();
  });

  it('fails when session key is missing', async () => {
    strategyRepository.findOne.mockResolvedValue({ id: 42, userId: 7 } as Strategy);

    const job: TransactionJobData = {
      strategyId: 42,
      userId: 7,
      intent: { type: 'swap', fromChain: 'base', toChain: 'base', fromToken: '0xIn', toToken: '0xOut', fromAmount: '1', userAddress: '0xuser' },
      quote: { id: 'q', transactionRequest: { to: '0xdead', data: '0xbeef' }, fromAmount: '1', toAmount: '1' },
    };

    await service.execute(job);

    expect(transactionLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        description: 'Session key is required for transaction execution.',
      }),
    );
    expect(signerService.signAndSend).not.toHaveBeenCalled();
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
      intent: { type: 'swap', fromChain: 'base', toChain: 'base', fromToken: '0xIn', toToken: '0xOut', fromAmount: '1', userAddress: '0xuser' },
      quote: { id: 'q', transactionRequest: { to: '0xdead', data: '0xbeef' }, fromAmount: '1', toAmount: '1' },
    };

    await service.execute(job);

    expect(transactionLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        description: 'Session key 9 does not permit swap actions.',
      }),
    );
    expect(signerService.signAndSend).not.toHaveBeenCalled();
  });

  it('delegates to signer when transaction request is prepared', async () => {
    strategyRepository.findOne.mockResolvedValue({ id: 10, userId: 3 } as Strategy);
    sessionKeyRepository.findOne.mockResolvedValue({
      id: 11,
      userId: 3,
      isActive: true,
      expiresAt: null,
      permissions: { actions: ['swap'] },
    } as SessionKey);
    signerService.signAndSend.mockResolvedValue({ status: 'pending', description: 'Awaiting signature' });

    const job: TransactionJobData = {
      strategyId: 10,
      userId: 3,
      sessionKeyId: 11,
      intent: { type: 'swap', fromChain: 'base', toChain: 'base', fromToken: '0xIn', toToken: '0xOut', fromAmount: '1', userAddress: '0xuser' },
      quote: { id: 'q', transactionRequest: { to: '0x123', data: '0xdeadbeef' }, fromAmount: '1', toAmount: '2' },
    };

    await service.execute(job);

    expect(signerService.signAndSend).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        sessionKeyId: 11,
        transaction: { to: '0x123', data: '0xdeadbeef' },
      }),
    );
  });
});
