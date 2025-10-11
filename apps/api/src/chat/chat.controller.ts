import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { AuthRequest } from '../auth/auth-request.interface';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('invoke')
  invokeAgent(
    @Body() body: { input: string; chatHistory?: [string, string][] },
    @Request() req: AuthRequest,
  ) {
    const history = (body.chatHistory || []).map(([human, ai]) => [
      new HumanMessage(human),
      new AIMessage(ai),
    ]).flat();
    // We can use req.user to pass user context to the agent
    return this.chatService.invokeAgent(body.input, history);
  }
}
