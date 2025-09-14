// Core blockchain services
export { SeiProvider } from './providers/SeiProvider';
export { EVMProvider } from './providers/EVMProvider';
export { CosmwasmProvider } from './providers/CosmwasmProvider';

// Client and connection management
export { SeiClient } from './clients/SeiClient';
export { SmartAccountClient } from './clients/SmartAccountClient';

// Contract interaction
export { AccountFactoryContract } from './contracts/AccountFactory';
export { SmartAccountContract } from './contracts/SmartAccount';
export { 
  ConditionalOrderEngineContract,
  OrderType,
  OrderStatus,
  ConditionType
} from './contracts/ConditionalOrderEngine';

// DEX integrations
export { AstroportAdapter } from './dex/AstroportAdapter';
export { DragonSwapAdapter } from './dex/DragonSwapAdapter';
export { WhiteWhaleAdapter } from './dex/WhiteWhaleAdapter';
export { BaseDexAdapter } from './dex/BaseDexAdapter';

// New DEX providers
export { DragonswapProvider } from './dex/dragonswap';
export { SymphonyProvider } from './dex/symphony';
export * from './executors';

// Automation system
export * from './automation/DCAScheduler';
export * from './automation/ConditionalOrderMonitor';
export * from './automation/AutomationManager';

// Utilities
export * from './utils/AddressUtils';
export * from './utils/TransactionUtils';
export * from './utils/GasEstimator';

// Types and interfaces
export * from './types';

// Constants
export * from './constants/networks';
export * from './constants/contracts';