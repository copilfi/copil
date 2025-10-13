import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Strategy, SessionKey, STRATEGY_QUEUE, TRANSACTION_QUEUE } from '@copil/database';

@Module({
  imports: [
    TypeOrmModule.forFeature([Strategy, SessionKey]),
    BullModule.registerQueue({ name: STRATEGY_QUEUE }),
    BullModule.registerQueue({ name: TRANSACTION_QUEUE }),
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService],
})
export class AutomationsModule {}
