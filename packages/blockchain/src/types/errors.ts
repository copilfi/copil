export class BlockchainError extends Error {
  public readonly code: string;
  public readonly context?: any;

  constructor(message: string, code: string = 'BLOCKCHAIN_ERROR', context?: any) {
    super(message);
    this.name = 'BlockchainError';
    this.code = code;
    this.context = context;
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BlockchainError);
    }
  }
}

export class ContractError extends BlockchainError {
  public readonly contractAddress?: string;

  constructor(message: string, contractAddress?: string, context?: any) {
    super(message, 'CONTRACT_ERROR', context);
    this.name = 'ContractError';
    this.contractAddress = contractAddress;
  }
}

export class TransactionError extends BlockchainError {
  public readonly transactionHash?: string;
  public readonly gasUsed?: bigint;

  constructor(message: string, transactionHash?: string, context?: any) {
    super(message, 'TRANSACTION_ERROR', context);
    this.name = 'TransactionError';
    this.transactionHash = transactionHash;
  }
}

export class NetworkError extends BlockchainError {
  public readonly chainId?: number;

  constructor(message: string, chainId?: number, context?: any) {
    super(message, 'NETWORK_ERROR', context);
    this.name = 'NetworkError';
    this.chainId = chainId;
  }
}

export class ValidationError extends BlockchainError {
  public readonly field?: string;

  constructor(message: string, field?: string, context?: any) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
    this.field = field;
  }
}