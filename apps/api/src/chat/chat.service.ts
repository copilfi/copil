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
import { TransactionAction } from '@copil/database';

// Existing Tool
class GetWalletBalanceTool extends StructuredTool {
  name = 'get_wallet_balance';
  description =
    'Get the token balances for a given wallet address on a specific chain. Supported chains are: ethereum, base, arbitrum, linea.';
  schema = z.object({
    address: z.string().describe('The wallet address to check.'),
    chain: z.string().describe('The chain to check the balance on.'),
  });

  constructor(private readonly portfolioService: PortfolioService) {
    super();
  }

  async _call({ address, chain }: z.infer<typeof this.schema>) {
    try {
      const balances = await this.portfolioService.getWalletBalance(
        address,
        chain,
      );
      return JSON.stringify(balances);
    } catch (error) {
      return `Error getting wallet balance: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }
}

// New Tool for Getting Quotes
class GetSwapQuoteTool extends StructuredTool {
  name = 'get_swap_quote';
  description =
    'Get a quote for a token swap. This should be used to show the user the expected outcome of a swap before executing it.';
  schema = z.object({
    fromChain: z.string().describe("The source chain name (e.g., 'ethereum')."),
    fromToken: z.string().describe("The source token address."),
    fromAmount: z
      .string()
      .describe(
        "The amount of the source token to sell (in its native decimals, e.g., '1000000000000000000' for 1 ETH).",
      ),
    toChain: z.string().describe("The destination chain name (e.g., 'base')."),
    toToken: z.string().describe("The destination token address."),
    userAddress: z
      .string()
      .describe("The user's wallet address performing the swap."),
  });

  constructor(private readonly transactionService: TransactionService) {
    super();
  }

  async _call({
    fromChain,
    fromToken,
    fromAmount,
    toChain,
    toToken,
    userAddress,
  }: z.infer<typeof this.schema>) {
    try {
      const quote = await this.transactionService.getQuote({
        fromChain: fromChain,
        fromToken: fromToken,
        fromAmount: fromAmount,
        toChain: toChain,
        toToken: toToken,
        fromAddress: userAddress,
      });
      // Correctly access properties from the quote object
      const fromChainId = quote.action.fromChainId;
      const toChainId = quote.action.toChainId;
      const gasCost = quote.estimate.gasCosts?.[0]?.amountUSD ?? '0';

      return `Quote received: Sell ${quote.action.fromAmount} of ${quote.action.fromToken} on chain ${fromChainId} to receive an estimated ${quote.estimate.toAmount} of ${quote.action.toToken} on chain ${toChainId}. Transaction cost is estimated at ${gasCost} USD.`;
    } catch (error) {
      return `Error getting quote: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }
}

// New Tool for Executing Swaps, now aware of the user context
class ExecuteSwapTool extends StructuredTool {
  name = 'execute_swap';
  description =
    'Execute a token swap. This should only be called after the user has confirmed the quote. Requires the session key ID to authorize the transaction.';
  schema = z.object({
    sessionKeyId: z
      .number()
      .describe('The session key ID to sign the transaction.'),
    swapAction: z
      .object({
        type: z.literal('swap'),
        chainId: z.string(),
        assetIn: z.string(),
        assetOut: z.string(),
        amountIn: z.string(),
        slippageBps: z.number().optional(),
      })
      .describe('The swap action object detailing the transaction.'),
  });

  constructor(
    private readonly transactionService: TransactionService,
    private readonly userId: number, // Injected user ID
  ) {
    super();
  }

  async _call({ sessionKeyId, swapAction }: z.infer<typeof this.schema>) {
    try {
      const result = await this.transactionService.createAdHocTransactionJob(
        this.userId, // Use the injected userId
        sessionKeyId,
        swapAction as TransactionAction,
      );
      return `Swap execution has been successfully queued. Job data: ${JSON.stringify(
        result,
      )}`;
    } catch (error) {
      return `Error executing swap: ${
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
      new GetWalletBalanceTool(this.portfolioService),
      new GetSwapQuoteTool(this.transactionService),
      new ExecuteSwapTool(this.transactionService, user.id), // Pass user.id during tool instantiation
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
        - get_wallet_balance: Use this to check a user's token balances on a specific chain.
        - get_swap_quote: Use this to get a price quote for a token swap. Always do this before executing a swap to inform the user of the cost and outcome.
        - execute_swap: Use this to execute a swap. You must only use this tool after the user has explicitly confirmed a quote you provided. You must ask the user for the sessionKeyId to use for the transaction.

        A typical user flow for a swap is:
        1. User asks to swap tokens.
        2. You use 'get_wallet_balance' if you need to know their current holdings.
        3. You use 'get_swap_quote' to get the details of the proposed swap.
        4. You present the quote to the user in a clear, human-readable format and ask for their confirmation to proceed.
        5. If the user confirms, you MUST ask them which sessionKeyId they want to use.
        6. Once you have the sessionKeyId, you call 'execute_swap' with the correct parameters from the quote and the provided sessionKeyId.`,
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
