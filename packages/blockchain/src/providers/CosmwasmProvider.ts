import { CosmWasmClient, SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice, calculateFee } from '@cosmjs/stargate';
import type { 
  NetworkConfig,
  CosmWasmContract,
  SeiCosmosTransaction,
  SeiAccountInfo
} from '../types';
import { BlockchainError } from '../types';
import axios from 'axios';

export interface CosmWasmExecuteMsg {
  [key: string]: any;
}

export interface CosmWasmQueryMsg {
  [key: string]: any;
}

export class CosmwasmProvider {
  private client?: CosmWasmClient;
  private signingClient?: SigningCosmWasmClient;
  private wallet?: DirectSecp256k1HdWallet;
  private gasPrice: GasPrice;

  constructor(
    private config: NetworkConfig,
    private rpcEndpoint: string,
    private lcdEndpoint: string,
    private mnemonic?: string
  ) {
    // Sei uses usei as the native token
    this.gasPrice = GasPrice.fromString('0.02usei');
  }

  async initialize(): Promise<void> {
    try {
      // Initialize read-only client
      this.client = await CosmWasmClient.connect(this.rpcEndpoint);

      // Initialize signing client if mnemonic is provided
      if (this.mnemonic) {
        this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
          this.mnemonic,
          { prefix: 'sei' }
        );

        this.signingClient = await SigningCosmWasmClient.connectWithSigner(
          this.rpcEndpoint,
          this.wallet,
          { gasPrice: this.gasPrice }
        );
      }
    } catch (error) {
      throw new BlockchainError(
        'Failed to initialize CosmWasm client',
        'INITIALIZATION_ERROR',
        error
      );
    }
  }

  // Contract query methods
  async queryContract(
    contractAddress: string,
    queryMsg: CosmWasmQueryMsg
  ): Promise<any> {
    if (!this.client) {
      await this.initialize();
    }

    try {
      return await this.client!.queryContractSmart(contractAddress, queryMsg);
    } catch (error) {
      throw new BlockchainError(
        `Failed to query contract ${contractAddress}`,
        'CONTRACT_QUERY_ERROR',
        error
      );
    }
  }

  // Contract execution methods
  async executeContract(
    contractAddress: string,
    executeMsg: CosmWasmExecuteMsg,
    funds: Array<{ denom: string; amount: string }> = []
  ): Promise<any> {
    if (!this.signingClient || !this.wallet) {
      throw new BlockchainError(
        'Signing client not initialized',
        'AUTH_ERROR'
      );
    }

    try {
      const [account] = await this.wallet.getAccounts();
      
      const fee = calculateFee(200000, this.gasPrice); // Conservative gas estimate
      
      const result = await this.signingClient.execute(
        account.address,
        contractAddress,
        executeMsg,
        fee,
        undefined,
        funds
      );

      return result;
    } catch (error) {
      throw new BlockchainError(
        `Failed to execute contract ${contractAddress}`,
        'CONTRACT_EXECUTION_ERROR',
        error
      );
    }
  }

  // Contract instantiation
  async instantiateContract(
    codeId: number,
    initMsg: CosmWasmExecuteMsg,
    label: string,
    funds: Array<{ denom: string; amount: string }> = [],
    admin?: string
  ): Promise<{
    contractAddress: string;
    transactionHash: string;
  }> {
    if (!this.signingClient || !this.wallet) {
      throw new BlockchainError(
        'Signing client not initialized',
        'AUTH_ERROR'
      );
    }

    try {
      const [account] = await this.wallet.getAccounts();
      
      const fee = calculateFee(500000, this.gasPrice); // Higher gas for instantiation
      
      const result = await this.signingClient.instantiate(
        account.address,
        codeId,
        initMsg,
        label,
        fee,
        {
          funds,
          admin: admin || account.address
        }
      );

      return {
        contractAddress: result.contractAddress,
        transactionHash: result.transactionHash
      };
    } catch (error) {
      throw new BlockchainError(
        'Failed to instantiate contract',
        'CONTRACT_INSTANTIATION_ERROR',
        error
      );
    }
  }

  // Code upload
  async uploadContract(
    wasmBytecode: Uint8Array,
    meta?: {
      source?: string;
      builder?: string;
    }
  ): Promise<{
    codeId: number;
    transactionHash: string;
  }> {
    if (!this.signingClient || !this.wallet) {
      throw new BlockchainError(
        'Signing client not initialized',
        'AUTH_ERROR'
      );
    }

    try {
      const [account] = await this.wallet.getAccounts();
      
      const fee = calculateFee(1000000, this.gasPrice); // High gas for upload
      
      const result = await this.signingClient.upload(
        account.address,
        wasmBytecode,
        fee
      );

      return {
        codeId: result.codeId,
        transactionHash: result.transactionHash
      };
    } catch (error) {
      throw new BlockchainError(
        'Failed to upload contract',
        'CONTRACT_UPLOAD_ERROR',
        error
      );
    }
  }

  // Migration
  async migrateContract(
    contractAddress: string,
    newCodeId: number,
    migrateMsg: CosmWasmExecuteMsg
  ): Promise<{
    transactionHash: string;
  }> {
    if (!this.signingClient || !this.wallet) {
      throw new BlockchainError(
        'Signing client not initialized',
        'AUTH_ERROR'
      );
    }

    try {
      const [account] = await this.wallet.getAccounts();
      
      const fee = calculateFee(300000, this.gasPrice);
      
      const result = await this.signingClient.migrate(
        account.address,
        contractAddress,
        newCodeId,
        migrateMsg,
        fee
      );

      return {
        transactionHash: result.transactionHash
      };
    } catch (error) {
      throw new BlockchainError(
        `Failed to migrate contract ${contractAddress}`,
        'CONTRACT_MIGRATION_ERROR',
        error
      );
    }
  }

  // Contract info queries
  async getContractInfo(contractAddress: string): Promise<CosmWasmContract> {
    if (!this.client) {
      await this.initialize();
    }

    try {
      const contractInfo = await this.client!.getContract(contractAddress);
      
      return {
        address: contractAddress,
        codeId: contractInfo.codeId,
        creator: contractInfo.creator,
        admin: contractInfo.admin,
        label: contractInfo.label
      };
    } catch (error) {
      throw new BlockchainError(
        `Failed to get contract info for ${contractAddress}`,
        'CONTRACT_INFO_ERROR',
        error
      );
    }
  }

  async getCodeInfo(codeId: number): Promise<{
    codeId: number;
    creator: string;
    checksum: string;
    source?: string;
    builder?: string;
  }> {
    if (!this.client) {
      await this.initialize();
    }

    try {
      const codeInfo = await this.client!.getCodeDetails(codeId);
      
      return {
        codeId,
        creator: codeInfo.creator,
        checksum: codeInfo.checksum,
        source: (codeInfo as any).source,
        builder: (codeInfo as any).builder
      };
    } catch (error) {
      throw new BlockchainError(
        `Failed to get code info for ${codeId}`,
        'CODE_INFO_ERROR',
        error
      );
    }
  }

  // Account and balance queries
  async getAccountInfo(address: string): Promise<SeiAccountInfo | null> {
    try {
      const response = await axios.get(
        `${this.lcdEndpoint}/cosmos/auth/v1beta1/accounts/${address}`
      );
      return response.data.account;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new BlockchainError(
        `Failed to get account info for ${address}`,
        'ACCOUNT_INFO_ERROR',
        error
      );
    }
  }

  async getBalance(address: string, denom: string = 'usei'): Promise<string> {
    try {
      const response = await axios.get(
        `${this.lcdEndpoint}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${denom}`
      );
      return response.data.balance?.amount || '0';
    } catch (error) {
      throw new BlockchainError(
        `Failed to get balance for ${address}`,
        'BALANCE_ERROR',
        error
      );
    }
  }

  async getAllBalances(address: string): Promise<Array<{ denom: string; amount: string }>> {
    try {
      const response = await axios.get(
        `${this.lcdEndpoint}/cosmos/bank/v1beta1/balances/${address}`
      );
      return response.data.balances || [];
    } catch (error) {
      throw new BlockchainError(
        `Failed to get all balances for ${address}`,
        'BALANCE_ERROR',
        error
      );
    }
  }

  // Transaction queries
  async getTransaction(hash: string): Promise<SeiCosmosTransaction | null> {
    try {
      const response = await axios.get(
        `${this.lcdEndpoint}/cosmos/tx/v1beta1/txs/${hash}`
      );
      return response.data.tx_response;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new BlockchainError(
        `Failed to get transaction ${hash}`,
        'TRANSACTION_ERROR',
        error
      );
    }
  }

  // Block queries
  async getLatestBlock(): Promise<any> {
    try {
      const response = await axios.get(
        `${this.lcdEndpoint}/cosmos/base/tendermint/v1beta1/blocks/latest`
      );
      return response.data.block;
    } catch (error) {
      throw new BlockchainError(
        'Failed to get latest block',
        'BLOCK_ERROR',
        error
      );
    }
  }

  async getBlockByHeight(height: number): Promise<any> {
    try {
      const response = await axios.get(
        `${this.lcdEndpoint}/cosmos/base/tendermint/v1beta1/blocks/${height}`
      );
      return response.data.block;
    } catch (error) {
      throw new BlockchainError(
        `Failed to get block at height ${height}`,
        'BLOCK_ERROR',
        error
      );
    }
  }

  // Utility methods
  async simulateExecute(
    contractAddress: string,
    executeMsg: CosmWasmExecuteMsg,
    funds: Array<{ denom: string; amount: string }> = []
  ): Promise<{
    gasUsed: number;
    gasWanted: number;
    events: any[];
  }> {
    if (!this.signingClient || !this.wallet) {
      throw new BlockchainError(
        'Signing client not initialized',
        'AUTH_ERROR'
      );
    }

    try {
      const [account] = await this.wallet.getAccounts();
      
      const result = await this.signingClient.simulate(
        account.address,
        [
          {
            typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
            value: {
              sender: account.address,
              contract: contractAddress,
              msg: Buffer.from(JSON.stringify(executeMsg)),
              funds
            }
          }
        ],
        undefined
      );

      return {
        gasUsed: (result as any).gasUsed || result,
        gasWanted: ((result as any).gasUsed || result) * 1.5, // Add some buffer
        events: []
      };
    } catch (error) {
      throw new BlockchainError(
        'Failed to simulate contract execution',
        'SIMULATION_ERROR',
        error
      );
    }
  }

  // Cleanup
  disconnect(): void {
    if (this.client) {
      this.client.disconnect();
    }
    if (this.signingClient) {
      this.signingClient.disconnect();
    }
  }

  // Getters
  getClient(): CosmWasmClient | undefined {
    return this.client;
  }

  getSigningClient(): SigningCosmWasmClient | undefined {
    return this.signingClient;
  }

  async getSignerAddress(): Promise<string> {
    if (!this.wallet) {
      throw new BlockchainError('Wallet not initialized', 'AUTH_ERROR');
    }

    const [account] = await this.wallet.getAccounts();
    return account.address;
  }
}