import { AxiosInstance } from 'axios';
import { TransactionIntent } from '@copil/database';

// Basic logger
const logger = {
    log: (...args: any[]) => console.log('[JupiterClient]', ...args),
    error: (...args: any[]) => console.error('[JupiterClient]', ...args),
};

const JUPITER_API_BASE_URL = 'https://quote-api.jup.ag/v6';

export class JupiterClient {
    private http: AxiosInstance;

    constructor(http: AxiosInstance) {
        this.http = http;
    }

    async getSwapTransaction(intent: TransactionIntent, userPublicKey: string): Promise<{ serializedTx?: string; error?: string }> {
        if (intent.type !== 'swap') {
            return { error: 'Only swap intents are supported by JupiterClient.' };
        }

        logger.log(`Getting Jupiter quote for ${intent.fromAmount} of ${intent.fromToken} -> ${intent.toToken}`);

        // Monetization: Read fee configuration from environment
        const feeBps = Number(process.env.JUPITER_FEE_BPS);
        const feeTokenMint = process.env.JUPITER_FEE_TOKEN_MINT;
        const feeTokenAccount = process.env.JUPITER_FEE_TOKEN_ACCOUNT;

        try {
            // 1. Get quote
            const quoteParams: any = {
                inputMint: intent.fromToken,
                outputMint: intent.toToken,
                amount: intent.fromAmount,
                slippageBps: (intent as any).slippageBps ?? 50, // Default 0.5% slippage
            };

            if (feeBps > 0) {
                quoteParams.platformFeeBps = feeBps;
            }

            const quoteResponse = await this.http.get(`${JUPITER_API_BASE_URL}/quote`, { params: quoteParams });

            if (!quoteResponse.data) {
                return { error: 'Failed to get a quote from Jupiter API.' };
            }

            // 2. Get the serialized transaction for the swap
            const swapRequestBody: any = {
                userPublicKey: userPublicKey,
                quoteResponse: quoteResponse.data,
                wrapAndUnwrapSol: true, // Automatically wrap/unwrap SOL if needed
            };

            // IMPORTANT: Only add the fee account if the swap output is the configured fee token
            // This prevents errors from providing an incorrect token account for the fee.
            const outputMint = quoteResponse.data.outMint;
            if (feeBps > 0 && feeTokenMint && feeTokenAccount && outputMint === feeTokenMint) {
                swapRequestBody.feeAccount = feeTokenAccount;
                logger.log(`Added Jupiter platform fee to account ${feeTokenAccount}`);
            }

            const swapResponse = await this.http.post(`${JUPITER_API_BASE_URL}/swap`, swapRequestBody);

            const serializedTx = swapResponse.data?.swapTransaction;
            if (!serializedTx) {
                return { error: 'Failed to get swap transaction from Jupiter API.' };
            }

            logger.log('Successfully got Jupiter swap transaction');
            return { serializedTx };

        } catch (error) {
            const errorMessage = (error as any).response?.data?.message ?? (error as Error).message;
            logger.error('Error fetching swap transaction from Jupiter:', errorMessage);
            return { error: `Jupiter API error: ${errorMessage}` };
        }
    }
}
