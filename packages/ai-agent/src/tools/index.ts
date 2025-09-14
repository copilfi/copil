export { BaseDeFiTool } from './BaseTools';
export { SwapTool, createSwapTool } from './SwapTool';
export { BalanceTool, createBalanceTool } from './BalanceTool';
export { LimitOrderTool, createLimitOrderTool } from './LimitOrderTool';
export { DCATool, createDCATool } from './DCATool';

import { Tool } from '@langchain/core/tools';
import { SeiProvider, DexExecutor, ConditionalOrderEngineContract } from '@copil/blockchain';
import { TokenResolver } from '../utils/TokenResolver';
import { createSwapTool } from './SwapTool';
import { createBalanceTool } from './BalanceTool';
import { createLimitOrderTool } from './LimitOrderTool';
import { createDCATool } from './DCATool';

export function createAllTools(
  seiProvider: SeiProvider,
  dexExecutor: DexExecutor,
  orderEngine: ConditionalOrderEngineContract,
  tokenResolver: TokenResolver
): Tool[] {
  return [
    createSwapTool(seiProvider, dexExecutor, orderEngine, tokenResolver),
    createBalanceTool(seiProvider, dexExecutor, orderEngine, tokenResolver),
    createLimitOrderTool(seiProvider, dexExecutor, orderEngine, tokenResolver),
    createDCATool(seiProvider, dexExecutor, orderEngine, tokenResolver),
  ];
}