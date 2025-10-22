import { Injectable } from '@nestjs/common';

@Injectable()
export class SolanaService {
  private get apiBase() {
    return process.env.JUPITER_API_URL || 'https://quote-api.jup.ag';
  }

  async getQuote(params: { inputMint: string; outputMint: string; amount: string | number; slippageBps?: number }) {
    const { inputMint, outputMint, amount } = params;
    const slippageBps = params.slippageBps ?? 50;
    const qs = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(amount),
      slippageBps: String(slippageBps),
    });
    const url = `${this.apiBase}/v6/quote?${qs.toString()}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status}`);
    return (await res.json()) as any;
  }

  async prepareSwap(params: { inputMint: string; outputMint: string; amount: string | number; userPublicKey: string; slippageBps?: number }) {
    const quote = await this.getQuote({ inputMint: params.inputMint, outputMint: params.outputMint, amount: params.amount, slippageBps: params.slippageBps });
    const body = {
      quoteResponse: quote,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      asLegacyTransaction: true,
    };
    const url = `${this.apiBase}/v6/swap`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Jupiter swap prepare failed: ${res.status}`);
    const data = (await res.json()) as any;
    return { serializedTx: data.swapTransaction as string, raw: data };
  }
}

