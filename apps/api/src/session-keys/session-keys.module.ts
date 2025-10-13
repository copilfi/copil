import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionKey } from '@copil/database';
import { SessionKeysService } from './session-keys.service';
import { SessionKeysController } from './session-keys.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SessionKey])],
  controllers: [SessionKeysController],
  providers: [SessionKeysService],
  exports: [SessionKeysService],
})
export class SessionKeysModule {}
