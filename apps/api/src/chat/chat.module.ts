import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatMemoryController } from './memory.controller';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TransactionModule } from '../transaction/transaction.module';
import { AutomationsModule } from '../automations/automations.module';
import { MarketModule } from '../market/market.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMemory, ChatEmbedding } from '@copil/database';

@Module({
  imports: [PortfolioModule, TransactionModule, AutomationsModule, MarketModule, TypeOrmModule.forFeature([ChatMemory, ChatEmbedding])],
  controllers: [ChatController, ChatMemoryController],
  providers: [ChatService],
})
export class ChatModule {}
