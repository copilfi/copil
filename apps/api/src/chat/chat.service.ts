import { Injectable, BadRequestException } from '@nestjs/common';
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
import { TransactionIntent, ChatMemory, ChatEmbedding } from '@copil/database';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MarketService } from '../market/market.service';
import { PromptValidator } from './prompt-validator';

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
      const jobIntent = result.intent;

      // Type-safe checks using discriminated unions
      if (jobIntent.type === 'open_position') {
        return `Hyperliquid order queued: Open ${jobIntent.side} ${jobIntent.size} USD ${jobIntent.market} x${jobIntent.leverage}.`;
      }
      if (jobIntent.type === 'close_position') {
        return `Hyperliquid order queued: Close position on ${jobIntent.market}.`;
      }
      if (jobIntent.type === 'swap' || jobIntent.type === 'bridge') {
        const quote = result.quote as { toAmount?: string };
        return `Transaction successfully queued! You will sell ${jobIntent.fromAmount} of ${jobIntent.fromToken} to receive an estimated ${quote?.toAmount ?? 'n/a'} of ${jobIntent.toToken}.`;
      }
      return `Transaction successfully queued!`;
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
    trigger: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('price'),
        chain: z.string(),
        tokenAddress: z.string(),
        priceTarget: z.number(),
        comparator: z.enum(['gte', 'lte']).optional(),
      }),
      z.object({
        type: z.literal('trend'),
        chain: z.string(),
        tokenAddress: z.string(),
        top: z.number().int().min(1).max(50).optional(),
      })
    ]),
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

// Tool: get_trending_tokens(chain?, limit?)
class GetTrendingTokensTool extends StructuredTool {
  name = 'get_trending_tokens';
  description = 'Returns a recent list of trending tokens for a chain (approximate, based on latest ingested TokenPrice records).';
  schema = z.object({ chain: z.string().optional(), limit: z.number().int().min(1).max(50).optional() });

  constructor(private readonly market: MarketService) { super(); }

  async _call(input: z.infer<typeof this.schema>) {
    try {
      const out = await this.market.getTrending({ chain: input.chain, limit: input.limit });
      return JSON.stringify(out);
    } catch (e) {
      return `Error fetching trending tokens: ${(e as Error).message}`;
    }
  }
}

// Tool: get_wallet_balance(chain, tokenOrAddress)
class GetWalletBalanceTool extends StructuredTool {
  name = 'get_wallet_balance';
  description = 'Returns the user\'s balance for a given chain and token (address or symbol) from the aggregated portfolio.';
  schema = z.object({ chain: z.string(), token: z.string().describe('ERC-20 address, native, or symbol') });

  constructor(private readonly portfolio: PortfolioService, private readonly userId: number) { super(); }

  private isAddress(s: string) { return /^0x[0-9a-fA-F]{40}$/.test(s); }

  async _call({ chain, token }: z.infer<typeof this.schema>) {
    try {
      const balances = (await this.portfolio.getPortfolioForUser(this.userId)) as any[];
      const lcChain = chain.toLowerCase();
      const lcTok = token.toLowerCase();
      const pick = balances.find((b: any) => {
        const id = String(b.assetId || '').toLowerCase();
        const sym = String(b.symbol || '').toLowerCase();
        if (!id.includes(lcChain)) return false;
        if (this.isAddress(token)) return id.includes(lcTok);
        if (lcTok === 'native') return sym === 'eth' || sym === lcChain || sym === 'sei' || sym === 'sol';
        return sym === lcTok;
      });
      if (!pick) return JSON.stringify({ amount: '0', amountUsd: '0', found: false });
      return JSON.stringify({ amount: String(pick.amount), amountUsd: String(pick.amountUsd ?? '0'), symbol: pick.symbol, found: true });
    } catch (e) {
      return `Error fetching balance: ${(e as Error).message}`;
    }
  }
}

// Tool: get_token_sentiment(symbol)
class GetTokenSentimentTool extends StructuredTool {
  name = 'get_token_sentiment';
  description = 'Returns latest sentiment score and tweet volume for a given token symbol (from ingested Twitter data).';
  schema = z.object({ symbol: z.string() });

  constructor(private readonly market: MarketService) { super(); }

  async _call({ symbol }: z.infer<typeof this.schema>) {
    try {
      const out = await this.market.getTokenSentiment(symbol);
      return JSON.stringify(out);
    } catch (e) {
      return `Error fetching sentiment: ${(e as Error).message}`;
    }
  }
}

@Injectable()
export class ChatService {
  private readonly promptValidator: PromptValidator;

  constructor(
    private readonly configService: ConfigService,
    private readonly portfolioService: PortfolioService,
    private readonly transactionService: TransactionService,
    private readonly automationsService: AutomationsService,
    private readonly marketService: MarketService,
    @InjectRepository(ChatMemory) private readonly memoryRepo: Repository<ChatMemory>,
    @InjectRepository(ChatEmbedding) private readonly embRepo: Repository<ChatEmbedding>,
  ) {
    this.promptValidator = new PromptValidator();
  }

  async invokeAgent(
    user: { id: number },
    input: string,
    chatHistory: (HumanMessage | AIMessage)[],
  ) {
    // Validate input for prompt injection attempts
    const validation = this.promptValidator.validateUserInput(input);
    if (!validation.safe) {
      throw new BadRequestException(validation.reason || 'Invalid input detected');
    }

    // Sanitize input before processing
    const sanitizedInput = this.promptValidator.sanitizeInput(input);

    const tools = [
      new GetPortfolioTool(this.portfolioService, user.id),
      new CompareQuotesTool(this.transactionService),
      new CreateTransactionTool(this.transactionService, user.id),
      new CreateAutomationTool(this.automationsService, user.id),
      new GetTrendingTokensTool(this.marketService),
      new GetWalletBalanceTool(this.portfolioService, user.id),
      new GetTokenSentimentTool(this.marketService),
    ];

    const llm = this.buildLlm();

    const priorMemory = await this.loadMemory(user.id);
    const recalls = await this.recallEmbeddings(user.id, sanitizedInput, 3).catch(() => [] as string[]);

    // Create secure system prompt that resists injection
    const systemPrompt = this.promptValidator.createSecureSystemPrompt(priorMemory, recalls);

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        systemPrompt + `

        Tools available:
        - get_portfolio: Aggregated balances for all wallets.
        - get_trending_tokens: Recent trending tokens by chain (from ingested data).
        - get_wallet_balance: Balance for a specific chain/token.
        - compare_quotes: Fetch and compare providers; prefer non-custodial executable routes.
        - create_transaction: Execute actions that move funds (EVM swap/bridge) or Hyperliquid order (open/close).
        - create_automation: Create price/trend-triggered automation using a session key.

        Policy:
        - NEVER move funds without explicit confirmation containing "confirm" or "yes" and a sessionKeyId.
        - For EVM swaps/bridges, compare quotes first; summarize tradeoffs (receive amount, readiness, constraints).
        - For Hyperliquid, present a concise order plan (market, side, size, leverage/slippage if any) and ask for confirmation.

        Mini examples:
        - User: "Base'de 100 USDC'yi ETH'e çevir."
          You: Use compare_quotes with intent, present summary, ask: "Onaylıyor musunuz? SessionKeyId?"
        - User: "BTC long 500 USDT eşdeğeri x3 HL aç."
          You: Present order plan (market BTC, long, size 500 USD, lev x3), then ask to confirm + sessionKeyId.

        Execution steps:
        1) Parse request → build intent.
        2) If EVM swap/bridge → compare_quotes → present options.
        3) Ask for explicit confirmation and sessionKeyId.
        4) Call create_transaction with confirmed=true.
        5) Summarize the result.`,
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
      input: sanitizedInput,  // Use sanitized input
      chat_history: chatHistory,
    });

    // Validate AI response before returning
    const responseValidation = this.promptValidator.validateAIResponse(result, input);
    if (!responseValidation.valid) {
      throw new BadRequestException(responseValidation.reason || 'Invalid AI response detected');
    }

    try {
      // Update memory with a concise summary (using original input for context)
      const outputText = String((result as any)?.output ?? '');
      const newSummary = await this.summarizeMemory(llm, priorMemory || '', input, outputText);
      await this.saveMemory(user.id, newSummary);

      // Store embedding only if input was safe
      await this.storeEmbedding(user.id, sanitizedInput).catch(() => void 0);
    } catch (error) {
      // Log but don't fail the request
      console.warn('Failed to update memory:', error);
    }

    return result;
  }

  private async storeEmbedding(userId: number, text: string): Promise<void> {
    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!openaiKey) return; // embeddings only when OpenAI is available
    const embedder = new OpenAIEmbeddings({ apiKey: openaiKey });
    const vec = await embedder.embedQuery(text);
    const rec = this.embRepo.create({ userId, content: text, embedding: vec });
    await this.embRepo.save(rec);
  }

  private cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) { const x = a[i]; const y = b[i]; dot += x*y; na += x*x; nb += y*y; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  private async recallEmbeddings(userId: number, query: string, k = 3): Promise<string[]> {
    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!openaiKey) return [];
    const embedder = new OpenAIEmbeddings({ apiKey: openaiKey });
    const q = await embedder.embedQuery(query);
    const recent = await this.embRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 200 });
    const scored = recent.map(r => ({ content: r.content, score: this.cosine(q, r.embedding) }));
    scored.sort((a,b) => b.score - a.score);
    return scored.slice(0, k).filter(s => s.score > 0.2).map(s => s.content);
  }

  private buildLlm(): ChatOpenAI {
    const provider = (this.configService.get<string>('LLM_PROVIDER') || '').toLowerCase();
    const groqKey = this.configService.get<string>('GROQ_API_KEY');
    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');

    const useGroq = provider === 'groq' || (!!groqKey && !openaiKey);
    if (useGroq) {
      const model = this.configService.get<string>('GROQ_MODEL') || 'llama-3.1-70b-versatile';
      return new ChatOpenAI({
        modelName: model,
        temperature: 0,
        apiKey: groqKey,
        configuration: { baseURL: 'https://api.groq.com/openai/v1' } as any,
      } as any);
    }
    const model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o';
    return new ChatOpenAI({ modelName: model, temperature: 0, apiKey: openaiKey });
  }

  private async loadMemory(userId: number): Promise<string | null> {
    try {
      const rec = await this.memoryRepo.findOne({ where: { userId } });
      return rec?.summary ?? null;
    } catch { return null; }
  }

  private async saveMemory(userId: number, summary: string): Promise<void> {
    if (!summary || !summary.trim()) return;
    const existing = await this.memoryRepo.findOne({ where: { userId } });
    if (existing) {
      existing.summary = summary;
      await this.memoryRepo.save(existing);
      return;
    }
    const rec = this.memoryRepo.create({ userId, summary });
    await this.memoryRepo.save(rec);
  }

  private async summarizeMemory(llm: ChatOpenAI, prior: string, lastUser: string, lastAssistant: string): Promise<string> {
    const sys = 'Summarize the conversation into a concise, user-centric memory. Keep under 1200 characters. Focus on persistent preferences, holdings context, and intent patterns. Avoid transient chatter.';
    const prompt = [
      { role: 'system', content: sys },
      { role: 'user', content: `Prior memory: ${prior || '(none)'}\n\nNew exchange:\nUser: ${lastUser}\nAssistant: ${lastAssistant}\n\nReturn only the updated memory text.` },
    ] as any;
    const res = await llm.invoke(prompt as any);
    const text = (res as any)?.content || '';
    return typeof text === 'string' ? text.trim() : JSON.stringify(text);
  }
}
