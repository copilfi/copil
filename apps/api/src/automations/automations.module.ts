import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Strategy, SessionKey, STRATEGY_QUEUE, TRANSACTION_QUEUE, TokenPrice } from '@copil/database';
import { PriceOracleService } from '../market/price-oracle.service';
import { RedisLockService } from '../common/redis-lock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Strategy, SessionKey, TokenPrice]),
    BullModule.registerQueue({ name: STRATEGY_QUEUE }),
    BullModule.registerQueue({ name: TRANSACTION_QUEUE }),
    BullModule.registerQueue({ name: 'default' }),
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService, PriceOracleService, RedisLockService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
