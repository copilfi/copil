import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '@copil/database';
import { JwtStrategy } from './jwt.strategy';
import { Wallet } from '@copil/database';
import { SmartAccountService } from './smart-account.service';
import { UrlValidatorService } from '../common/url-validator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Wallet]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET')!,
        signOptions: { expiresIn: '60m' }, // Example expiration
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SmartAccountService, UrlValidatorService],
  exports: [AuthService, SmartAccountService],
})
export class AuthModule {}
