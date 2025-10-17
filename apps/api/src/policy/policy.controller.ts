import { Controller, Get, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { PolicyService } from './policy.service';

@UseGuards(JwtAuthGuard)
@Controller('policy')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get('guard')
  async prepareGuard(@Request() req: AuthRequest, @Query('chain') chain?: string) {
    if (!chain) {
      throw new BadRequestException('Missing chain parameter.');
    }
    return this.policyService.prepareSetGuardTx(req.user.id, chain);
  }
}

