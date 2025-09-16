import { Contract, ethers } from 'ethers';
import type { SeiProvider } from '../providers/SeiProvider';
import type { SessionKeyConfig } from '../types';
import { ContractError } from '../types';
import { SMART_ACCOUNT_ABI } from '../constants/contracts';

export class SmartAccountContract {
  private contract: Contract;

  constructor(
    private provider: SeiProvider,
    private accountAddress: string,
    signer?: any
  ) {
    const evmProvider = signer || provider.getEvmProvider();
    this.contract = new Contract(accountAddress, SMART_ACCOUNT_ABI, evmProvider);
  }

  /**
   * Get account owner
   */
  async getOwner(): Promise<string> {
    try {
      return await this.contract.owner();
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to get account owner',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Get account nonce
   */
  async getNonce(): Promise<string> {
    try {
      const nonce = await this.contract.getNonce();
      return nonce.toString();
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to get account nonce',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Execute a single transaction
   */
  async execute(
    dest: string,
    value: string,
    data: string
  ): Promise<{
    transactionHash: string;
    success: boolean;
  }> {
    try {
      const tx = await this.contract.execute(
        dest,
        ethers.parseEther(value || '0'),
        data
      );
      
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash,
        success: receipt.status === 1
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to execute transaction',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Execute multiple transactions in batch
   */
  async executeBatch(
    destinations: string[],
    values: string[],
    datas: string[]
  ): Promise<{
    transactionHash: string;
    success: boolean;
  }> {
    try {
      const ethValues = values.map(v => ethers.parseEther(v || '0'));
      
      const tx = await this.contract.executeBatch(
        destinations,
        ethValues,
        datas
      );
      
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash,
        success: receipt.status === 1
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to execute batch transaction',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Execute automated transaction using session key
   */
  async executeAutomated(
    dest: string,
    value: string,
    data: string,
    sessionKey: string
  ): Promise<{
    transactionHash: string;
    success: boolean;
  }> {
    try {
      const tx = await this.contract.executeAutomated(
        dest,
        ethers.parseEther(value || '0'),
        data,
        sessionKey
      );
      
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash,
        success: receipt.status === 1
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to execute automated transaction',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Create a new session key
   */
  async createSessionKey(config: SessionKeyConfig): Promise<{
    transactionHash: string;
    sessionKey: string;
  }> {
    try {
      const tx = await this.contract.createSessionKey(
        config.sessionKey,
        config.validUntil,
        ethers.parseEther(config.limitAmount),
        config.allowedTargets,
        config.allowedFunctions
      );
      
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash,
        sessionKey: config.sessionKey
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to create session key',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Revoke a session key
   */
  async revokeSessionKey(sessionKey: string): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.revokeSessionKey(sessionKey);
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to revoke session key',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Add a guardian for emergency recovery
   */
  async addGuardian(guardian: string): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.addGuardian(guardian);
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to add guardian',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Remove a guardian
   */
  async removeGuardian(guardian: string): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.removeGuardian(guardian);
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to remove guardian',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Emergency recovery (requires guardian signatures)
   */
  async emergencyRecovery(
    newOwner: string,
    guardianAddresses: string[],
    guardianSignatures: string[]
  ): Promise<{
    transactionHash: string;
  }> {
    try {
      const tx = await this.contract.emergencyRecovery(
        newOwner,
        guardianAddresses,
        guardianSignatures
      );
      
      const receipt = await tx.wait();
      
      return {
        transactionHash: receipt.hash
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to execute emergency recovery',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Get account information
   */
  async getAccountInfo(): Promise<{
    owner: string;
    nonce: string;
    balance: string;
    guardianCount: number;
    isDeployed: boolean;
  }> {
    try {
      const [owner, nonce, balance] = await Promise.all([
        this.getOwner(),
        this.getNonce(),
        this.provider.getBalance(this.accountAddress)
      ]);

      // Check if contract is deployed
      const code = await this.provider.getEvmProvider().getCode(this.accountAddress);
      const isDeployed = code !== '0x';

      return {
        owner,
        nonce,
        balance,
        guardianCount: 0, // Would need to implement getter in contract
        isDeployed
      };
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to get account information',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Listen to ownership transfer events
   */
  onOwnershipTransferred(
    callback: (previousOwner: string, newOwner: string) => void
  ): void {
    this.contract.on('OwnershipTransferred', (previousOwner, newOwner) => {
      callback(previousOwner, newOwner);
    });
  }

  /**
   * Listen to guardian events
   */
  onGuardianAdded(callback: (guardian: string) => void): void {
    this.contract.on('GuardianAdded', (guardian) => {
      callback(guardian);
    });
  }

  onGuardianRemoved(callback: (guardian: string) => void): void {
    this.contract.on('GuardianRemoved', (guardian) => {
      callback(guardian);
    });
  }

  /**
   * Listen to emergency recovery events
   */
  onEmergencyRecovery(
    callback: (newOwner: string, guardians: string[]) => void
  ): void {
    this.contract.on('EmergencyRecovery', (newOwner, guardians) => {
      callback(newOwner, guardians);
    });
  }

  /**
   * Listen to operation executed events
   */
  onOperationExecuted(
    callback: (operationHash: string, success: boolean) => void
  ): void {
    this.contract.on('OperationExecuted', (operationHash, success) => {
      callback(operationHash, success);
    });
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    fromBlock: number = 0,
    toBlock: number | 'latest' = 'latest'
  ): Promise<Array<{
    type: 'execute' | 'executeBatch' | 'executeAutomated';
    transactionHash: string;
    blockNumber: number;
    success: boolean;
    details: any;
  }>> {
    try {
      // This would require parsing transaction logs and events
      // For now, return empty array - would need more complex implementation
      return [];
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to get transaction history',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Estimate gas for execution
   */
  async estimateExecuteGas(
    dest: string,
    value: string,
    data: string
  ): Promise<string> {
    try {
      const gasEstimate = await this.contract.execute.estimateGas(
        dest,
        ethers.parseEther(value || '0'),
        data
      );
      return gasEstimate.toString();
    } catch (error: unknown) {
      throw new ContractError(
        'Failed to estimate execution gas',
        this.accountAddress,
        error
      );
    }
  }

  /**
   * Get contract instance
   */
  getContract(): Contract {
    return this.contract;
  }

  /**
   * Get account address
   */
  getAddress(): string {
    return this.accountAddress;
  }
}