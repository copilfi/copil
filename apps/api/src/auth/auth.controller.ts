import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthRequest } from './auth-request.interface';
import { Throttle } from '@nestjs/throttler';

class LoginRequestDto {
  walletAddress?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 10000 } })
  async login(@Request() req: AuthRequest, @Body() _body: LoginRequestDto) {
    const user = await this.authService.getUserById(req.user.id);
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: AuthRequest) {
    // req.user is now populated by the JwtStrategy with the user's db id, privyDid, and email
    return req.user;
  }
}
