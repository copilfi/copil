import { z } from 'zod';
import { Address } from 'viem';

// Agent Configuration
export const AgentConfigSchema = z.object({
  openaiApiKey: z.string(),
  model: z.string().default('gpt-4-turbo'),
  temperature: z.number().min(0).max(2).default(0.1),
  maxTokens: z.number().default(1000),
  verbose: z.boolean().default(false),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Natural Language Processing Types
export interface Intent {
  action: DeFiAction;
  confidence: number;
  entities: Record<string, any>;
  rawText: string;
}

export enum DeFiAction {
  SWAP = 'swap',
  LIMIT_ORDER = 'limit_order',
  DCA = 'dca',
  STAKE = 'stake',
  UNSTAKE = 'unstake',
  ADD_LIQUIDITY = 'add_liquidity',
  REMOVE_LIQUIDITY = 'remove_liquidity',
  CHECK_BALANCE = 'check_balance',
  GET_PRICE = 'get_price',
  CANCEL_ORDER = 'cancel_order',
  VIEW_ORDERS = 'view_orders'
}

export interface SwapIntent {
  tokenFrom: string;
  tokenTo: string;
  amount: number;
  slippage?: number;
  deadline?: number;
}

export interface LimitOrderIntent {
  tokenFrom: string;
  tokenTo: string;
  amount: number;
  targetPrice: number;
  orderType: 'buy' | 'sell';
  deadline?: number;
}

export interface DCAIntent {
  tokenFrom: string;
  tokenTo: string;
  totalBudget: number;
  frequency: 'daily' | 'weekly' | 'monthly' | number; // seconds if number
  duration?: number; // days
}

export interface BalanceIntent {
  token?: string;
}

export interface PriceIntent {
  token: string;
  vs?: string; // comparison token, default USDC
}

// Agent Response Types
export interface AgentResponse {
  message: string;
  action?: DeFiAction;
  transactionHash?: string;
  data?: any;
  error?: string;
  suggestions?: string[];
  confidence?: number;
  success?: boolean;
  toolResults?: ToolResult[];
}

export interface TransactionResult {
  hash: string;
  success: boolean;
  message: string;
  gasUsed?: bigint;
  error?: string;
}

// Tool Types for LangChain
export interface ToolInput {
  [key: string]: any;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message: string;
}

// Context for conversation history
export interface ConversationContext {
  userId: string;
  sessionId: string;
  walletAddress?: Address;
  lastAction?: DeFiAction;
  pendingOrders?: string[];
  preferences?: UserPreferences;
}

export interface UserPreferences {
  defaultSlippage?: number;
  preferredDex?: string;
  riskTolerance?: 'low' | 'medium' | 'high';
  notifications?: boolean;
}

// Memory and Session Management
export interface SessionMemory {
  shortTerm: Record<string, any>;
  longTerm: Record<string, any>;
  transactionHistory: TransactionResult[];
  lastActivity: Date;
}

// Error Types
export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export class NLPError extends AgentError {
  constructor(message: string, details?: any) {
    super(message, 'NLP_ERROR', details);
  }
}

export class ToolExecutionError extends AgentError {
  constructor(message: string, details?: any) {
    super(message, 'TOOL_EXECUTION_ERROR', details);
  }
}

// Token Recognition Types
export interface TokenMatch {
  symbol: string;
  address: Address;
  name: string;
  decimals: number;
  confidence: number;
}

export interface TokenDatabase {
  [symbol: string]: {
    address: Address;
    name: string;
    decimals: number;
    aliases: string[];
  };
}

// Validation Schemas
export const SwapIntentSchema = z.object({
  tokenFrom: z.string(),
  tokenTo: z.string(),
  amount: z.number().positive(),
  slippage: z.number().min(0).max(0.5).optional(),
  deadline: z.number().optional(),
});

export const LimitOrderIntentSchema = z.object({
  tokenFrom: z.string(),
  tokenTo: z.string(),
  amount: z.number().positive(),
  targetPrice: z.number().positive(),
  orderType: z.enum(['buy', 'sell']),
  deadline: z.number().optional(),
});

export const DCAIntentSchema = z.object({
  tokenFrom: z.string(),
  tokenTo: z.string(),
  totalBudget: z.number().positive(),
  frequency: z.union([z.enum(['daily', 'weekly', 'monthly']), z.number().positive()]),
  duration: z.number().positive().optional(),
});