import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Strategy } from '@copil/database';

@Module({
  imports: [TypeOrmModule.forFeature([Strategy]), BullModule.registerQueue({ name: 'strategy-queue' })],
  controllers: [AutomationsController],
  providers: [AutomationsService],
})
export class AutomationsModule {}
