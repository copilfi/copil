import { Controller, Post, UseGuards, Body, Request, Get, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { SmartAccountOrchestratorService } from './smart-account.service';

@UseGuards(JwtAuthGuard)
@Controller('smart-account')
export class SmartAccountController {
  constructor(private readonly orchestrator: SmartAccountOrchestratorService) {}

  @Post('deploy')
  deploy(@Request() req: AuthRequest, @Body() body: { chain: string; sessionKeyId: number }) {
    if (!body?.chain || !body?.sessionKeyId) {
      throw new Error('chain and sessionKeyId are required');
    }
    return this.orchestrator.deploy(req.user.id, String(body.sessionKeyId), body.chain);
  }

  @Get('status')
  status(@Request() req: AuthRequest, @Query('chain') chain?: string) {
    return this.orchestrator.status(req.user.id, chain);
  }
}
