import { Controller, Post, Body, UseGuards, Request, Get, Param, Patch } from '@nestjs/common';
import { SessionKeysService } from './session-keys.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthRequest } from '../auth/auth-request.interface';
import { CreateSessionKeyDto } from './dto/create-session-key.dto';
import { UpdateSessionKeyDto } from './dto/update-session-key.dto';

@UseGuards(JwtAuthGuard)
@Controller('session-keys')
export class SessionKeysController {
  constructor(private readonly sessionKeysService: SessionKeysService) {}

  @Post()
  create(@Request() req: AuthRequest, @Body() dto: CreateSessionKeyDto) {
    return this.sessionKeysService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: AuthRequest) {
    return this.sessionKeysService.findAll(req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Request() req: AuthRequest, @Body() dto: UpdateSessionKeyDto) {
    return this.sessionKeysService.update(Number(id), req.user.id, dto);
  }
}
