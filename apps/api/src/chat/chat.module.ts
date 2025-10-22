import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TransactionModule } from '../transaction/transaction.module';
import { AutomationsModule } from '../automations/automations.module';

@Module({
  imports: [PortfolioModule, TransactionModule, AutomationsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
