import { Contract, ethers } from 'ethers';
import type { SeiProvider } from '../providers/SeiProvider';
import type { SmartAccountConfig } from '../types';
import { ContractError } from '../types/errors';
import { ACCOUNT_FACTORY_ABI } from '../constants/contracts';
import { generateRandomBytes32 } from '../utils/AddressUtils';

export class AccountFactoryContract {
  private contract: Contract;

  constructor(
    private provider: SeiProvider,
    private factoryAddress: string,
    signer?: any
  ) {
    const evmProvider = signer || provider.getEvmProvider();
    this.contract = new Contract(factoryAddress, ACCOUNT_FACTORY_ABI, evmProvider);
  }

  /**
   * Create a new Smart Account
   */
  async createAccount(
    owner: string,
    salt?: string
  ): Promise<{
    accountAddress: string;
    transactionHash: string;
    isNew: boolean;
  }> {
    try {
      const accountSalt = salt || generateRandomBytes32();
      
      // Check if account already exists
      const existingAccount = await this.getAccount(owner);
      if (existingAccount !== ethers.ZeroAddress) {
        return {
          accountAddress: existingAccount,
          transactionHash: '',
          isNew: false
        };
      }

      // Create new account
      const tx = await this.contract.createAccount(owner, accountSalt);
      const receipt = await tx.wait();

      // Find AccountCreated event
      const event = receipt.logs.find((log: any) => 
        log.topics[0] === this.contract.interface.getEvent('AccountCreated')?.topicHash
      );

      if (!event) {
        throw new ContractError('AccountCreated event not found', this.factoryAddress);
      }

      const decodedEvent = this.contract.interface.parseLog(event);
      if (!decodedEvent) {
        throw new ContractError('Failed to decode AccountCreated event', this.factoryAddress);
      }
      
      return {
        accountAddress: decodedEvent.args.account,
        transactionHash: receipt.hash,
        isNew: true
      };
    } catch (error) {
      throw new ContractError(
        'Failed to create Smart Account',
        this.factoryAddress,
        error
      );
    }
  }

  /**
   * Get Smart Account address for owner
   */
  async getAccount(owner: string): Promise<string> {
    try {
      return await this.contract.getAccount(owner);
    } catch (error) {
      throw new ContractError(
        'Failed to get Smart Account address',
        this.factoryAddress,
        error
      );
    }
  }

  /**
   * Predict Smart Account address before deployment
   */
  async getAddress(owner: string, salt: string): Promise<string> {
    try {
      return await (this.contract as any).getAddress(owner, salt);
    } catch (error) {
      throw new ContractError(
        'Failed to predict Smart Account address',
        this.factoryAddress,
        error
      );
    }
  }

  /**
   * Check if address is a Smart Account created by this factory
   */
  async isAccount(address: string): Promise<boolean> {
    try {
      return await this.contract.isAccount(address);
    } catch (error) {
      throw new ContractError(
        'Failed to verify Smart Account',
        this.factoryAddress,
        error
      );
    }
  }

  /**
   * Batch create multiple Smart Accounts
   */
  async batchCreateAccounts(
    owners: string[],
    salts?: string[]
  ): Promise<{
    accountAddresses: string[];
    transactionHash: string;
    newAccounts: boolean[];
  }> {
    try {
      const accountSalts = salts || owners.map(() => generateRandomBytes32());
      
      if (owners.length !== accountSalts.length) {
        throw new Error('Owners and salts arrays must have the same length');
      }

      // Check for existing accounts
      const existingAccounts = await Promise.all(
        owners.map(owner => this.getAccount(owner))
      );

      const newAccounts = existingAccounts.map(addr => addr === ethers.ZeroAddress);
      const hasNewAccounts = newAccounts.some(isNew => isNew);

      if (!hasNewAccounts) {
        return {
          accountAddresses: existingAccounts,
          transactionHash: '',
          newAccounts
        };
      }

      // Create batch transaction
      const tx = await this.contract.batchCreateAccounts(owners, accountSalts);
      const receipt = await tx.wait();

      // Parse events to get addresses
      const events = receipt.logs
        .filter((log: any) => 
          log.topics[0] === this.contract.interface.getEvent('AccountCreated')?.topicHash
        )
        .map((log: any) => this.contract.interface.parseLog(log))
        .filter((event: any) => event !== null);

      const createdAddresses = events.map((event: any) => event.args.account);
      
      // Merge existing and new addresses
      const accountAddresses = existingAccounts.map((existing, index) => 
        existing === ethers.ZeroAddress ? createdAddresses.shift() : existing
      );

      return {
        accountAddresses,
        transactionHash: receipt.hash,
        newAccounts
      };
    } catch (error) {
      throw new ContractError(
        'Failed to batch create Smart Accounts',
        this.factoryAddress,
        error
      );
    }
  }

  /**
   * Get factory statistics
   */
  async getFactoryStats(): Promise<{
    totalAccounts: number;
    implementationAddress: string;
    entryPointAddress: string;
  }> {
    try {
      // This would require additional view functions in the factory contract
      // For now, return placeholder data
      return {
        totalAccounts: 0,
        implementationAddress: '0x...',
        entryPointAddress: '0x...'
      };
    } catch (error) {
      throw new ContractError(
        'Failed to get factory statistics',
        this.factoryAddress,
        error
      );
    }
  }

  /**
   * Listen to AccountCreated events
   */
  onAccountCreated(
    callback: (owner: string, account: string, salt: string) => void
  ): void {
    this.contract.on('AccountCreated', (owner, account, salt) => {
      callback(owner, account, salt);
    });
  }

  /**
   * Get historical account creation events
   */
  async getAccountCreationHistory(
    fromBlock: number = 0,
    toBlock: number | 'latest' = 'latest',
    owner?: string
  ): Promise<Array<{
    owner: string;
    account: string;
    salt: string;
    blockNumber: number;
    transactionHash: string;
  }>> {
    try {
      const filter = this.contract.filters.AccountCreated(owner, null, null);
      const events = await this.contract.queryFilter(filter, fromBlock, toBlock);

      return events.map((event: any) => ({
        owner: event.args.owner,
        account: event.args.account,
        salt: event.args.salt,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      }));
    } catch (error) {
      throw new ContractError(
        'Failed to get account creation history',
        this.factoryAddress,
        error
      );
    }
  }

  /**
   * Estimate gas for account creation
   */
  async estimateCreateAccountGas(owner: string, salt?: string): Promise<string> {
    try {
      const accountSalt = salt || generateRandomBytes32();
      const gasEstimate = await this.contract.createAccount.estimateGas(owner, accountSalt);
      return gasEstimate.toString();
    } catch (error) {
      throw new ContractError(
        'Failed to estimate gas for account creation',
        this.factoryAddress,
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
   * Get factory address
   */
  getFactoryAddress(): string {
    return this.factoryAddress;
  }
}