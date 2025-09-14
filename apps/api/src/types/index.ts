// Basic types for the API without external dependencies

export interface User {
  id: string;
  address: string;
  email?: string;
  createdAt: Date;
  lastLoginAt?: Date;
  preferences?: any;
}

export interface SmartAccount {
  id: string;
  address: string;
  userId: string;
  isActive: boolean;
  createdAt: Date;
  sessionKeys?: SessionKey[];
}

export interface SessionKey {
  id: string;
  sessionKey: string;
  validUntil: Date;
  limitAmount: string;
  usageCount: number;
  maxUsageCount: number;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  revokedAt?: Date;
  allowedTargets?: string[];
  allowedFunctions?: string[];
}

export interface Transaction {
  id: string;
  hash: string;
  userId: string;
  type: string;
  status: string;
  details?: any;
  createdAt: Date;
}

export interface BlockchainEvent {
  id: string;
  contractAddress: string;
  eventName: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  args: any;
  timestamp: Date;
  processed: boolean;
  processedAt?: Date;
  blockHash: string;
}

export interface Strategy {
  id: string;
  name: string;
  userId: string;
  status: string;
  conditionalOrderId?: string;
  completedAt?: Date;
}