import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TransactionService } from '../transaction/transaction.service';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { pull } from 'langchain/hub';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

class GetWalletBalanceTool extends StructuredTool {
  name = 'get_wallet_balance';
  description = 'Get the token balances for a given wallet address on a specific chain. Supported chains are: ethereum, base, arbitrum, linea.';
  schema = z.object({
    address: z.string().describe('The wallet address to check.'),
    chain: z.string().describe('The chain to check the balance on.'),
  });

  constructor(private readonly portfolioService: PortfolioService) {
    super();
  }

  async _call({ address, chain }: z.infer<typeof this.schema>) {
    try {
      const balances = await this.portfolioService.getWalletBalance(address, chain);
      return JSON.stringify(balances);
    } catch (error) {
      if (error instanceof Error) {
        return `Error getting wallet balance: ${error.message}`;
      }
      return 'An unknown error occurred';
    }
  }
}

@Injectable()
export class ChatService {
  constructor(
    private readonly configService: ConfigService,
    private readonly portfolioService: PortfolioService,
    private readonly transactionService: TransactionService,
  ) {}

  async invokeAgent(input: string, chatHistory: (HumanMessage | AIMessage)[]) {
    const tools = [new GetWalletBalanceTool(this.portfolioService)];

    const llm = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0,
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    // Attempt to use the LangChain Hub prompt; fall back to a local prompt if unavailable
    let prompt: ChatPromptTemplate;
    try {
      prompt = await pull<ChatPromptTemplate>('hwchase17/openai-tools-agent');
    } catch (e) {
      prompt = ChatPromptTemplate.fromMessages([
        [
          'system',
          'You are Copil, an AI DeFi assistant. Use tools when needed and be concise. If you need on-chain balances, call get_wallet_balance.',
        ],
        new MessagesPlaceholder('chat_history'),
        ['human', '{input}'],
      ]);
    }

    const agent = await createOpenAIToolsAgent({
      llm,
      tools,
      prompt,
    });

    const agentExecutor = new AgentExecutor({
      agent,
      tools,
    });

    const result = await agentExecutor.invoke({
      input,
      chat_history: chatHistory,
    });

    return result;
  }
}
