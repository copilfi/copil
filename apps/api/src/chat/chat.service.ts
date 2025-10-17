import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TransactionService } from '../transaction/transaction.service';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { pull } from 'langchain/hub';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TransactionIntent } from '@copil/database';

// Tool to get the user's entire portfolio
class GetPortfolioTool extends StructuredTool {
  name = 'get_portfolio';
  description = "Get the user's aggregated token balances across all supported chains.";
  schema = z.object({}); // No parameters needed as user is inferred

  constructor(private readonly portfolioService: PortfolioService, private readonly userId: number) {
    super();
  }

  async _call(_: z.infer<typeof this.schema>) {
    try {
      const portfolio = await this.portfolioService.getPortfolioForUser(this.userId);
      return JSON.stringify(portfolio);
    } catch (error) {
      return `Error getting portfolio: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }
}

// A single tool to handle quoting and executing a transaction
class CreateTransactionTool extends StructuredTool {
  name = 'create_transaction';
  description =
    'Gets a quote and queues a transaction based on user intent. This is the primary tool for any action that moves funds. The user must confirm the action before this tool is called.';
  schema = z.object({
    sessionKeyId: z
      .number()
      .describe('The session key ID required to authorize the transaction.'),
    intent: z.object({
        type: z.enum(['swap', 'bridge', 'custom']).describe("The type of transaction."),
        fromChain: z.string().describe("The source chain name (e.g., 'ethereum')."),
        fromToken: z.string().describe("The source token symbol or address (e.g., 'ETH', '0x...')."),
        fromAmount: z.string().describe("The amount of the source token to send (in native units)."),
        toChain: z.string().describe("The destination chain name (e.g., 'base')."),
        toToken: z.string().describe("The destination token symbol or address."),
        userAddress: z.string().describe("The user's wallet address performing the transaction."),
        name: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      })
      .describe("The user's intent for the transaction"),
  });

  constructor(
    private readonly transactionService: TransactionService,
    private readonly userId: number,
  ) {
    super();
  }

  async _call({ sessionKeyId, intent }: z.infer<typeof this.schema>) {
    try {
      // The service now handles getting the quote and enqueuing the job
      const result = await this.transactionService.createAdHocTransactionJob(
        this.userId,
        sessionKeyId,
        intent as TransactionIntent, // Cast to the correct type
      );
      
      const quote = result.quote as any;
      const jobIntent = result.intent as any;
      return `Transaction successfully queued! You will sell ${jobIntent.fromAmount} of ${jobIntent.fromToken} to receive an estimated ${quote.toAmount} of ${jobIntent.toToken}.`;
    } catch (error) {
      return `Error creating transaction: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
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

  async invokeAgent(
    user: { id: number },
    input: string,
    chatHistory: (HumanMessage | AIMessage)[],
  ) {
    const tools = [
      new GetPortfolioTool(this.portfolioService, user.id),
      new CreateTransactionTool(this.transactionService, user.id),
    ];

    const llm = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0,
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are Copil, an AI DeFi assistant. Your goal is to help users by answering questions and executing transactions on their behalf.

        You have access to the following tools:
        - get_portfolio: Use this to check the user's token balances across all their wallets.
        - create_transaction: Use this to perform any action that moves funds, like swapping or bridging tokens.

        IMPORTANT: Before using 'create_transaction', you MUST follow these steps:
        1. Understand the user's request (e.g., "swap 1 ETH for USDC on Base").
        2. Determine all the parameters for the 'intent' object for the 'create_transaction' tool.
        3. Present the plan to the user in a clear, human-readable format. For example: "I am about to swap 1 ETH on Ethereum for USDC on Base on your behalf."
        4. Ask for their explicit confirmation to proceed.
        5. After confirmation, you MUST ask them for the sessionKeyId to use for the transaction.
        6. Only after you have confirmation AND the sessionKeyId, you may call the 'create_transaction' tool.`,
      ],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
      new MessagesPlaceholder('agent_scratchpad'),
    ]);

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
