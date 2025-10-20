import { Controller, Post, UseGuards, Get, Request, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

import { AuthRequest } from './auth-request.interface';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  async login(@Body() body: { privyDid: string, email: string, walletAddress?: string }) {
    const user = await this.authService.findOrCreateUser(body.privyDid, body.email, body.walletAddress);
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: AuthRequest) {
    // req.user is now populated by the JwtStrategy with the user's db id, privyDid, and email
    return req.user;
  }
}
