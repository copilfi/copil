export * from './types';
export * from './agents/DeFiAgent';
export * from './tools';
export * from './utils/TokenResolver';

import { DeFiAgent } from './agents/DeFiAgent';
import { TokenResolver } from './utils/TokenResolver';
import { AgentConfig } from './types';
import { SeiProvider, DexExecutor, ConditionalOrderEngineContract } from '@copil/blockchain';

/**
 * Factory function to create a DeFi Agent instance
 */
export function createDeFiAgent(
  config: AgentConfig,
  seiProvider: SeiProvider,
  dexExecutor: DexExecutor,
  orderEngine: ConditionalOrderEngineContract
): DeFiAgent {
  const tokenResolver = new TokenResolver();
  
  return new DeFiAgent(
    config,
    seiProvider,
    dexExecutor,
    orderEngine,
    tokenResolver
  );
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4-turbo',
  temperature: 0.1,
  maxTokens: 1000,
  verbose: false
};