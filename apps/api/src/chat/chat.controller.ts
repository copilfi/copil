import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { AuthRequest } from '../auth/auth-request.interface';
import { Throttle } from '@nestjs/throttler';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Changed from @Post('invoke') to @Post() to match frontend call to /api/chat
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  invokeAgent(
    @Body() body: { input: string; chatHistory?: [string, string][] },
    @Request() req: AuthRequest,
  ) {
    const history = (body.chatHistory || [])
      .map(([human, ai]) => [new HumanMessage(human), new AIMessage(ai)])
      .flat();

    // Pass the entire user object to the service layer
    return this.chatService.invokeAgent(req.user, body.input, history);
  }
}
