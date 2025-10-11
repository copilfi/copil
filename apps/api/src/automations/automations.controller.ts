import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { AuthRequest } from '../auth/auth-request.interface';

@UseGuards(JwtAuthGuard)
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Post()
  create(@Body() createStrategyDto: CreateStrategyDto, @Request() req: AuthRequest) {
    return this.automationsService.create(createStrategyDto, req.user.id);
  }

  @Get()
  findAll(@Request() req: AuthRequest) {
    return this.automationsService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.automationsService.findOne(+id, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateStrategyDto: UpdateStrategyDto, @Request() req: AuthRequest) {
    return this.automationsService.update(+id, updateStrategyDto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.automationsService.remove(+id, req.user.id);
  }
}
