import { z } from 'zod';
import { BaseDeFiTool } from './BaseTools';
import { Address } from 'viem';

const BalanceToolSchema = z.object({
  token: z.string().optional().nullable().describe('Token symbol or address to check balance for (e.g., "SEI", "WSEI", "USDC"). If not provided, shows all major token balances'),
});

export class BalanceTool extends BaseDeFiTool {
  name = 'check_balance';
  description = 'Check token balance for the connected wallet. Can check specific token or show overview of all major tokens.';

  constructor(
    seiProvider: any,
    dexExecutor: any,
    orderEngine: any,
    tokenResolver: any
  ) {
    super(
      seiProvider,
      dexExecutor,
      orderEngine,
      tokenResolver,
      BalanceToolSchema
    );
  }

  protected async executeTyped(input: z.infer<typeof BalanceToolSchema>): Promise<string> {
    try {
      const { token } = input;
      const walletAddress = this.seiProvider.getAddress() as Address;

      if (token) {
        // Check specific token balance
        return await this.getSpecificTokenBalance(token, walletAddress);
      } else {
        // Show overview of major tokens
        return await this.getAllTokenBalances(walletAddress);
      }

    } catch (error) {
      const errorResult = await this.handleError(error, 'check balance');
      return JSON.stringify(errorResult);
    }
  }

  private async getSpecificTokenBalance(tokenSymbol: string, walletAddress: Address): Promise<string> {
    const tokenMatch = await this.tokenResolver.resolveToken(tokenSymbol);
    
    if (!tokenMatch) {
      return JSON.stringify({
        success: false,
        error: 'Token not found',
        message: `Could not resolve token: ${tokenSymbol}`
      });
    }

    let balance: bigint;
    
    if (tokenMatch.symbol === 'SEI') {
      // Native SEI balance
      const balanceStr = await this.seiProvider.getBalance(walletAddress);
      balance = BigInt(balanceStr);
    } else {
      // ERC-20 token balance
      balance = await this.getERC20Balance(tokenMatch.address as Address, walletAddress);
    }

    const formattedBalance = this.formatTokenAmount(balance, tokenMatch.decimals);

    return JSON.stringify({
      success: true,
      message: `Your ${tokenMatch.symbol} balance is ${formattedBalance} ${tokenMatch.symbol}`,
      data: {
        token: {
          symbol: tokenMatch.symbol,
          name: tokenMatch.name,
          address: tokenMatch.address,
          decimals: tokenMatch.decimals
        },
        balance: formattedBalance,
        balanceWei: balance.toString()
      }
    });
  }

  private async getAllTokenBalances(walletAddress: Address): Promise<string> {
    const majorTokens = [
      { symbol: 'SEI', name: 'SEI', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
      { symbol: 'WSEI', name: 'Wrapped SEI', address: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7' as Address, decimals: 18 },
      // Add more major tokens as needed
    ];

    const balances = [];

    for (const token of majorTokens) {
      try {
        let balance: bigint;
        
        if (token.symbol === 'SEI') {
          const balanceStr = await this.seiProvider.getBalance(walletAddress);
          balance = BigInt(balanceStr);
        } else {
          balance = await this.getERC20Balance(token.address, walletAddress);
        }

        const formattedBalance = this.formatTokenAmount(balance, token.decimals);
        
        // Only include tokens with non-zero balance
        if (balance > 0n) {
          balances.push({
            symbol: token.symbol,
            name: token.name,
            balance: formattedBalance,
            balanceWei: balance.toString()
          });
        }
      } catch (error) {
        console.error(`Error fetching balance for ${token.symbol}:`, error);
        // Continue with other tokens
      }
    }

    return JSON.stringify({
      success: true,
      message: `Found ${balances.length} tokens with balance in your wallet`,
      data: {
        balances,
        walletAddress
      }
    });
  }

  private async getERC20Balance(tokenAddress: Address, walletAddress: Address): Promise<bigint> {
    const publicClient = this.seiProvider.getViemPublicClient();
    
    if (!publicClient) {
      throw new Error('Public client not available');
    }

    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          type: 'function',
          name: 'balanceOf',
          stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        }
      ],
      functionName: 'balanceOf',
      args: [walletAddress]
    });

    return balance as bigint;
  }
}

export function createBalanceTool(
  seiProvider: any,
  dexExecutor: any,
  orderEngine: any,
  tokenResolver: any
): BalanceTool {
  return new BalanceTool(seiProvider, dexExecutor, orderEngine, tokenResolver);
}