import { ConflictException, NotFoundException } from '@nestjs/common';
import { SessionKeysService } from './session-keys.service';
import { SessionKey } from '@copil/database';
import { Repository } from 'typeorm';

type RepositoryMock<T> = {
  [K in keyof Repository<T>]?: jest.Mock;
} & {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

function createRepositoryMock<T>(): RepositoryMock<T> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  } as RepositoryMock<T>;
}

describe('SessionKeysService', () => {
  let repo: RepositoryMock<SessionKey>;
  let service: SessionKeysService;

  beforeEach(() => {
    repo = createRepositoryMock<SessionKey>();
    repo.create.mockImplementation((entity) => entity as SessionKey);
    repo.save.mockImplementation(async (entity) => entity as SessionKey);
    service = new SessionKeysService(repo as unknown as Repository<SessionKey>);
  });

  it('throws when creating a duplicate session key', async () => {
    repo.findOne.mockResolvedValue({ id: 1 } as SessionKey);

    await expect(
      service.create(1, { publicKey: '0xabc', permissions: {}, isActive: true }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps permissions when creating a session key', async () => {
    repo.findOne.mockResolvedValue(null);

    await service.create(3, {
      publicKey: '0xabc',
      permissions: { actions: ['swap'], chains: ['base'], notes: 'limited' },
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: { actions: ['swap'], chains: ['base'], notes: 'limited' },
      }),
    );
  });

  it('updates an existing session key', async () => {
    const existing: SessionKey = {
      id: 2,
      userId: 5,
      publicKey: '0x123',
      permissions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
      isActive: true,
      user: {} as any,
    };

    repo.findOne.mockResolvedValue(existing);
    const result = await service.update(2, 5, { isActive: false });

    expect(result.isActive).toBe(false);
  });

  it('throws when updating missing session key', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.update(99, 1, { isActive: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
