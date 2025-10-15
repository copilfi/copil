import { Injectable, Logger } from '@nestjs/common';
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

  async findOrCreateUser(privyDid: string, email: string, walletAddress?: string): Promise<User> {
    let user = await this.userRepository.findOne({
      where: { privyDid },
      relations: ['wallets'],
    });

    if (!user) {
      this.logger.log(`Creating new user for privy DID ${privyDid}`);
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
}
