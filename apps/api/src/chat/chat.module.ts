import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [PortfolioModule, TransactionModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
