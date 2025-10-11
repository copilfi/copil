import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '@copil/database';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async findOrCreateUser(privyDid: string, email: string): Promise<User> {
    let user = await this.userRepository.findOne({ where: { privyDid } });

    if (!user) {
      const newUser = this.userRepository.create({ privyDid, email });
      user = await this.userRepository.save(newUser);
    }

    return user;
  }

  async login(user: User) {
    const payload = { 
      sub: user.id, // Use the integer database ID as the subject
      privyDid: user.privyDid, 
      email: user.email 
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
