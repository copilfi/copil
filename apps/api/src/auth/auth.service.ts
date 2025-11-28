import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { User, Wallet } from '@copil/database';
import { Repository } from 'typeorm';
import { SmartAccountService } from './smart-account.service';

const DEFAULT_CHAINS = ['ethereum', 'base', 'arbitrum', 'linea'];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    private readonly jwtService: JwtService,
    private readonly smartAccountService: SmartAccountService,
  ) {}

  async findOrCreateUser(privyDid: string, email: string | undefined, walletAddress?: string): Promise<User> {
    // First try to find by privyDid (the primary identifier)
    let user = await this.userRepository.findOne({
      where: { privyDid },
      relations: ['wallets'],
    });

    if (user) {
      // Update email if changed
      if (email && user.email !== email) {
        this.logger.log(`Updating email for user ${user.id} from ${user.email} to ${email}`);
        user.email = email;
        user = await this.userRepository.save(user);
      }
      return user;
    }

    // User not found, create new one
    this.logger.log(`Creating new user for privy DID ${privyDid}`);

    try {
      const newUser = this.userRepository.create({ privyDid, email });
      user = await this.userRepository.save(newUser);

      // For a new user, optionally create wallet entries for default chains when an EOA is provided
      if (walletAddress) {
        await this.createWalletsForUser(user, walletAddress);
      }

      // Re-fetch user with wallets
      user = await this.userRepository.findOne({
        where: { id: user.id },
        relations: ['wallets'],
      });
    } catch (error: unknown) {
      // Handle race condition - user might have been created by another request
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
        this.logger.warn(`Race condition detected for privyDid ${privyDid}, fetching existing user`);
        user = await this.userRepository.findOne({
          where: { privyDid },
          relations: ['wallets'],
        });
        if (!user) {
          throw error; // Re-throw if we still can't find the user
        }
      } else {
        throw error;
      }
    }

    return user!;
  }

  private async createWalletsForUser(user: User, eoaAddress: string) {
    for (const chainName of DEFAULT_CHAINS) {
      try {
        this.logger.log(`Creating wallet entry for user ${user.id} on chain ${chainName}`);
        
        const smartAccountAddress = await this.smartAccountService.getSmartAccountAddress(
          eoaAddress as `0x${string}`,
          chainName,
        );

        this.logger.log(`Calculated Smart Account address for ${user.id} on ${chainName}: ${smartAccountAddress}`);

        const newWallet = this.walletRepository.create({
          userId: user.id,
          address: eoaAddress, // The EOA from Privy
          chain: chainName,
          smartAccountAddress, // The calculated Safe address
        });
        await this.walletRepository.save(newWallet);

      } catch (error) {
        this.logger.error(
          `Failed to create wallet or calculate smart account for user ${user.id} on chain ${chainName}`,
          error,
        );
      }
    }
  }

  async login(user: User) {
    const payload = {
      sub: user.id,
      privyDid: user.privyDid,
      email: user.email,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async getUserById(id: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id }, relations: ['wallets'] });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
