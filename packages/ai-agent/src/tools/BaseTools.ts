import { Tool } from '@langchain/core/tools';
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager';
import { z } from 'zod';
import { SeiProvider } from '@copil/blockchain';
import { DexExecutor, DexProtocol } from '@copil/blockchain';
import { ConditionalOrderEngineContract } from '@copil/blockchain';
import { ToolInput, ToolResult, AgentError } from '../types';
import { TokenResolver } from '../utils/TokenResolver';

export abstract class BaseDeFiTool extends Tool {
  protected seiProvider: SeiProvider;
  protected dexExecutor: DexExecutor;
  protected orderEngine: ConditionalOrderEngineContract;
  protected tokenResolver: TokenResolver;
  protected inputSchema: z.ZodSchema;
  
  // Required properties from Tool base class
  abstract name: string;
  abstract description: string;

  constructor(
    seiProvider: SeiProvider,
    dexExecutor: DexExecutor,
    orderEngine: ConditionalOrderEngineContract,
    tokenResolver: TokenResolver,
    inputSchema: z.ZodSchema
  ) {
    super();
    
    this.seiProvider = seiProvider;
    this.dexExecutor = dexExecutor;
    this.orderEngine = orderEngine;
    this.tokenResolver = tokenResolver;
    this.inputSchema = inputSchema;
    
    // Create a LangChain compatible schema after calling super()
    this.schema = z.object({
      input: z.string().optional()
    }).transform((data) => data.input);
  }

  /**
   * LangChain Tool interface implementation
   * Handles string input and delegates to typed implementation
   */
  async _call(
    arg: string | undefined,
    runManager?: CallbackManagerForToolRun
  ): Promise<string> {
    try {
      let parsedInput: any;
      
      if (typeof arg === 'string' && arg.trim()) {
        try {
          // Try to parse as JSON first
          parsedInput = JSON.parse(arg);
        } catch {
          // If not JSON, treat as simple string input
          parsedInput = { input: arg };
        }
      } else {
        throw new Error('Invalid input: expected non-empty string');
      }

      // Validate against schema
      const validatedInput = this.inputSchema.parse(parsedInput);
      
      // Call the typed implementation
      const result = await this.executeTyped(validatedInput);
      
      // Return as string (LangChain requirement)
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error: any) {
      const errorResult = await this.handleError(error, this.name);
      return JSON.stringify(errorResult);
    }
  }

  /**
   * Typed implementation that subclasses should override
   */
  protected abstract executeTyped(input: any): Promise<string | object>;

  protected async handleError(error: any, context: string): Promise<ToolResult> {
    console.error(`Error in ${context}:`, error);
    
    return {
      success: false,
      error: error.message,
      message: `Failed to ${context}: ${error.message}`
    };
  }

  protected formatTokenAmount(amount: bigint, decimals: number = 18): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const remainder = amount % divisor;
    
    if (remainder === 0n) {
      return whole.toString();
    }
    
    const fractional = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fractional ? `${whole}.${fractional}` : whole.toString();
  }

  protected parseTokenAmount(amount: string | number, decimals: number = 18): bigint {
    const amountStr = amount.toString();
    const [whole, fractional = ''] = amountStr.split('.');
    
    const wholeBigInt = BigInt(whole || '0');
    const fractionalPadded = fractional.padEnd(decimals, '0').slice(0, decimals);
    const fractionalBigInt = BigInt(fractionalPadded || '0');
    
    return wholeBigInt * (10n ** BigInt(decimals)) + fractionalBigInt;
  }
}
