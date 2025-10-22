import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TransactionService } from '../transaction/transaction.service';
import { AutomationsService } from '../automations/automations.service';
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

class CompareQuotesTool extends StructuredTool {
  name = 'compare_quotes';
  description =
    'Compare quotes from multiple providers (OneBalance primary, Li.Fi as reference). Use this before executing a transaction to present options to the user. This does not move funds.';
  schema = z.object({
    intent: z.object({
      type: z.enum(['swap', 'bridge']).describe('The type of transaction.'),
      fromChain: z.string(),
      toChain: z.string(),
      fromToken: z.string(),
      toToken: z.string(),
      fromAmount: z.string(),
      userAddress: z.string(),
      slippageBps: z.number().optional(),
    }),
  });

  constructor(private readonly transactionService: TransactionService) {
    super();
  }

  async _call({ intent }: z.infer<typeof this.schema>) {
    try {
      const res = await this.transactionService.compareQuotes(intent as TransactionIntent);
      const ob = res.onebalance;
      const lifi = res.lifi;

      const obLine = ob.supported
        ? `OneBalance: est receive ${ob.quote?.toAmount ?? 'n/a'} (tx ready: yes)`
        : `OneBalance: unavailable (${ob.error ?? 'n/a'})`;
      const lifiLine = lifi.supported
        ? `Li.Fi: est receive ${lifi.raw?.estimate?.toAmount ?? 'n/a'} (tx ready: ${lifi.transactionRequest ? 'yes' : 'no'})`
        : `Li.Fi: unavailable (${lifi.error ?? 'n/a'})`;

      return [
        'Quote comparison:',
        `- ${obLine}`,
        `- ${lifiLine}`,
        'Note: Only non-custodial, locally signable transactions will be executed.',
      ].join('\n');
    } catch (error) {
      return `Error comparing quotes: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

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
    confirmed: z
      .boolean()
      .describe('Must be true to proceed. Set after explicit user confirmation.'),
    intent: z.discriminatedUnion('type', [
      z.object({
        type: z.enum(['swap', 'bridge']).describe('EVM or cross-chain transaction.'),
        fromChain: z.string(),
        toChain: z.string(),
        fromToken: z.string(),
        toToken: z.string(),
        fromAmount: z.string(),
        userAddress: z.string(),
        slippageBps: z.number().optional(),
      }),
      z.object({
        type: z.literal('custom'),
        name: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional().default({}),
      }),
      z.object({
        type: z.literal('open_position'),
        chain: z.literal('hyperliquid'),
        market: z.string().describe("Market symbol, e.g. 'BTC', 'ETH'."),
        side: z.enum(['long', 'short']),
        size: z.string().describe('Notional size in USD (as string).'),
        leverage: z.number().describe('Leverage multiplier (e.g., 3).'),
        slippage: z.number().optional().describe('Optional slippage as decimal (e.g., 0.003 for 0.3%).'),
      }),
      z.object({
        type: z.literal('close_position'),
        chain: z.literal('hyperliquid'),
        market: z.string().describe("Market symbol, e.g. 'BTC', 'ETH'."),
      }),
    ]).describe("The user's intent for the transaction"),
  });

  constructor(
    private readonly transactionService: TransactionService,
    private readonly userId: number,
  ) {
    super();
  }

  async _call({ sessionKeyId, intent, confirmed }: z.infer<typeof this.schema>) {
    try {
      if (!confirmed) {
        return 'This action moves funds. Please ask the user to confirm and call the tool again with confirmed=true.';
      }
      // The service now handles getting the quote and enqueuing the job
      const result = await this.transactionService.createAdHocTransactionJob(
        this.userId,
        sessionKeyId,
        intent as TransactionIntent, // Cast to the correct type
      );
      const jobIntent = result.intent as any;
      if (jobIntent.type === 'open_position') {
        return `Hyperliquid order queued: Open ${jobIntent.side} ${jobIntent.size} USD ${jobIntent.market} x${jobIntent.leverage}.`;
      }
      if (jobIntent.type === 'close_position') {
        return `Hyperliquid order queued: Close position on ${jobIntent.market}.`;
      }
      const quote = result.quote as any;
      return `Transaction successfully queued! You will sell ${jobIntent.fromAmount} of ${jobIntent.fromToken} to receive an estimated ${quote?.toAmount ?? 'n/a'} of ${jobIntent.toToken}.`;
    } catch (error) {
      return `Error creating transaction: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }
}

class CreateAutomationTool extends StructuredTool {
  name = 'create_automation';
  description = 'Creates a price-triggered automation strategy that runs without further approval.';
  schema = z.object({
    name: z.string().min(3).max(80),
    trigger: z.object({
      type: z.literal('price'),
      chain: z.string(),
      tokenAddress: z.string(),
      priceTarget: z.number(),
      comparator: z.enum(['gte', 'lte']).optional(),
    }),
    intent: z.discriminatedUnion('type', [
      z.object({
        type: z.enum(['swap', 'bridge']),
        fromChain: z.string(),
        toChain: z.string(),
        fromToken: z.string(),
        toToken: z.string(),
        fromAmount: z.string(),
        userAddress: z.string(),
        slippageBps: z.number().optional(),
        amountInIsPercentage: z.boolean().optional(),
      }),
      z.object({
        type: z.literal('open_position'),
        chain: z.literal('hyperliquid'),
        market: z.string(),
        side: z.enum(['long', 'short']),
        size: z.string(),
        leverage: z.number(),
        slippage: z.number().optional(),
      }),
      z.object({
        type: z.literal('close_position'),
        chain: z.literal('hyperliquid'),
        market: z.string(),
      }),
    ]),
    sessionKeyId: z.number().describe('Session key used to sign the automation executions.'),
    repeat: z.boolean().optional().default(true),
    schedule: z.string().optional().describe('Cron pattern. If omitted, condition-based poll runs every minute.'),
    isActive: z.boolean().optional().default(true),
  });

  constructor(private readonly automations: AutomationsService, private readonly userId: number) {
    super();
  }

  async _call(input: z.infer<typeof this.schema>) {
    try {
      const dto = {
        name: input.name,
        definition: {
          trigger: input.trigger,
          intent: input.intent,
          sessionKeyId: input.sessionKeyId,
          repeat: input.repeat,
        },
        schedule: input.schedule,
        isActive: input.isActive,
      } as any;
      const created = await this.automations.create(dto, this.userId);
      return `Automation created with id=${created.id}, name="${created.name}", active=${created.isActive}.`;
    } catch (error) {
      return `Error creating automation: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

@Injectable()
export class ChatService {
  constructor(
    private readonly configService: ConfigService,
    private readonly portfolioService: PortfolioService,
    private readonly transactionService: TransactionService,
    private readonly automationsService: AutomationsService,
  ) {}

  async invokeAgent(
    user: { id: number },
    input: string,
    chatHistory: (HumanMessage | AIMessage)[],
  ) {
    const tools = [
      new GetPortfolioTool(this.portfolioService, user.id),
      new CompareQuotesTool(this.transactionService),
      new CreateTransactionTool(this.transactionService, user.id),
      new CreateAutomationTool(this.automationsService, user.id),
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
        - compare_quotes: Use this to retrieve quotes from multiple providers (OneBalance primary, Li.Fi as reference) and present options to the user.
        - create_transaction: Use this to perform any action that moves funds (EVM swaps/bridges) or to place Hyperliquid perpetual orders (open/close position).
        - create_automation: Use this to create a price-triggered automation strategy (EVM swap/bridge or Hyperliquid open/close). It will run without further approvals using the provided sessionKeyId.

        IMPORTANT: Before using 'create_transaction' or 'create_automation', follow these steps:
        1. Understand the user's request (e.g., "swap 1 ETH for USDC on Base").
        2. Determine all the parameters for the 'intent' object.
           - For EVM (swap/bridge): include optional 'slippageBps' if provided. Call 'compare_quotes' and present options, then ask for confirmation.
           - For Hyperliquid (open_position/close_position): skip 'compare_quotes'. Present the order plan (market, side, size/leverage or close), then ask for confirmation.
        3. After confirmation, ask for the sessionKeyId to use.
        4. Only after you have confirmation AND the sessionKeyId, call 'create_transaction' (for immediate execution) or 'create_automation' (for price-triggered execution).
           When calling 'create_transaction', you MUST set confirmed=true.`,
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
