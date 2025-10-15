import { Controller, Post, UseGuards, Get, Request, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

import { AuthRequest } from './auth-request.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
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
