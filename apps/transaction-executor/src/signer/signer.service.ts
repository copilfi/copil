import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { http, createPublicClient, parseEther, Chain, createWalletClient, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, arbitrum, linea, mainnet, optimism, polygon, bsc, avalanche } from 'viem/chains';
import { entryPoint06Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless/clients';
import { toSafeSmartAccount } from 'permissionless/accounts';
import * as solana from '@solana/web3.js';
import bs58 from 'bs58';
import { ethers } from 'ethers';
import { HttpTransport, ExchangeClient, InfoClient } from '@nktkas/hyperliquid';
import { BundlerClient } from '../clients/bundler.client';
import { PaymasterClient } from '../clients/paymaster.client';
import { InjectRepository } from '@nestjs/typeorm';
import { Wallet, SessionKey, SessionKeyPermissions } from '@copil/database';
import { Repository } from 'typeorm';
import { seiChain, hyperliquidChain } from '@copil/chain-abstraction-client';

export interface SignAndSendRequest {
  userId: number;
  sessionKeyId: number;
  wallet: Wallet; // Pass the full wallet context
  transaction?: {
    to: `0x${string}` | string; // Allow string for Solana
    data: `0x${string}`;
    value?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface SignAndSendResult {
  status: 'success' | 'pending' | 'failed';
  txHash?: string;
  description?: string;
}

// EVM chains for viem
const chainMap: Record<string, Chain> = {
  ethereum: mainnet, base, arbitrum, linea, optimism, polygon, bsc, avalanche, sei: seiChain, hyperliquid: hyperliquidChain,
};

const SOLANA_CHAIN_NAME = 'solana';

@Injectable()
export class SignerService {
  private readonly logger = new Logger(SignerService.name);
  private hlAssetCache: { exp: number; map: Map<string, { id: number; szDecimals: number; maxLeverage: number }> } | null = null;
  private hlOneShotFlags = { agentApproved: false, builderFeeApproved: false };
  private hlMetrics: {
    total: number;
    success: number;
    failed: number;
    lastError?: string;
    perSymbol: Map<string, { total: number; success: number; failed: number; avgLatencyMs: number }>
  } = { total: 0, success: 0, failed: 0, perSymbol: new Map() };

  constructor(
    private readonly configService: ConfigService,
    private readonly bundlerClient: BundlerClient,
    private readonly paymasterClient: PaymasterClient,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(SessionKey)
    private readonly sessionKeyRepository: Repository<SessionKey>,
  ) {}

  /**
   * Main dispatcher for signing transactions. It checks the wallet type and delegates to the appropriate method.
   */
  async signAndSend(request: SignAndSendRequest): Promise<SignAndSendResult> {
    const intent = request.metadata?.intent as any;
    if (intent?.type === 'open_position' || intent?.type === 'close_position') {
      return this.executeHyperliquidTrade(request);
    }
    if (request.wallet.type === 'eoa') {
      return this.signAndSendEoa(request);
    }
    return this.signAndSendSmartAccount(request);
  }

  private async executeHyperliquidTrade(request: SignAndSendRequest): Promise<SignAndSendResult> {
    this.logger.log('Executing a Hyperliquid trade');
    const { sessionKeyId, metadata } = request;
    const intent = metadata?.intent as any;
    const t0 = Date.now();

    const sessionKey = this.getSessionKey(sessionKeyId);
    if (!sessionKey) {
      return { status: 'failed', description: `Private key for session key ID ${sessionKeyId} not found.` };
    }

    // Per-user/symbol simple concurrency lock
    const symbolResolved = this.resolveMarketSymbol(String(intent.market));
    const lockKey = `${request.userId}:${symbolResolved}`;
    if (!this.acquireHlLock(lockKey)) {
      return { status: 'failed', description: `Another ${symbolResolved} trade is in progress for this user.` };
    }
    try {
      const transport = new HttpTransport();
      const exch = new ExchangeClient({ transport, wallet: sessionKey });
      const info = new InfoClient({ transport });

      const symbol = symbolResolved;

      // Enforce HL policy (session key permissions extension)
      const policyErr = await this.enforceHlPolicy(request.sessionKeyId, intent, symbol);
      if (policyErr) return policyErr;
      const asset = await this.getHyperliquidAssetMeta(info, symbol);
      if (!asset) {
        return { status: 'failed', description: `Hyperliquid market not found: ${symbol}` };
      }

      // Mid price and IOC limit price
      const mids = await this.retry(async () => await info.allMids());
      const midPxStr = mids[symbol];
      if (!midPxStr) {
        return { status: 'failed', description: `No mid price for ${symbol}` };
      }
      const midPx = Number(midPxStr);
      const tob = await this.getTopOfBook(info, symbol);
      const slip = this.computeAdaptiveSlippage(tob?.bid ?? null, tob?.ask ?? null, Number(intent.slippage));
      const sideOpen = intent.side === 'long';

      // Close vs Open logic
      if (intent.type === 'close_position') {
        const pos = await this.getHyperliquidPosition(info, String(request.wallet.address));
        const coinPos = pos.find((p) => p.coin.toUpperCase() === symbol);
        if (!coinPos) {
          return { status: 'failed', description: `No open position to close for ${symbol}` };
        }
        const szi = Number(coinPos.szi);
        if (!szi || Number.isNaN(szi)) {
          return { status: 'failed', description: `Invalid position size for ${symbol}` };
        }
        const isLong = szi > 0;
        const isBuy = !isLong; // close long => sell, close short => buy
        const px = this.chooseIocPrice(midPx, tob?.bid ?? null, tob?.ask ?? null, slip, isBuy);
        const qty = Math.abs(szi);
        const sizeStr = this.formatDecimal(qty, asset.szDecimals);
        const priceStr = this.formatDecimal(px, 6);

        await this.ensureAgentAndBuilder(exch);
        const chunked = this.isChunkingEnabled();
        if (chunked) {
          const res = await this.executeChunkedOrders(exch, asset.id, isBuy, px, qty, asset.szDecimals, true /*reduceOnly*/);
          this.recordHlMetric(symbol, Date.now() - t0, res.status === 'success', res.description);
          return res;
        } else {
          const res = await this.placeOrder(exch, asset.id, isBuy, px, qty, asset.szDecimals, true);
          this.recordHlMetric(symbol, Date.now() - t0, res.status === 'success', res.description);
          return res;
        }
      }

      // Open position flow
      // Optionally set leverage (cross)
      const lev = Number(intent.leverage ?? 1);
      if (lev > 1) {
        if (lev > asset.maxLeverage) {
          this.logger.warn(`Requested leverage ${lev} exceeds max ${asset.maxLeverage} for ${symbol}. Clamping.`);
        }
        const levToSet = Math.min(lev, asset.maxLeverage);
        try {
          const isCross = (this.configService.get<string>('HL_LEVERAGE_MODE') ?? 'cross').toLowerCase() !== 'isolated';
          await this.retry(async () => await exch.updateLeverage({ asset: asset.id, isCross, leverage: levToSet }));
        } catch (e) {
          this.logger.warn(`updateLeverage failed for ${symbol}: ${(e as Error).message}`);
        }
      }

      const isBuy = sideOpen; // long => buy, short => sell
      const px = this.chooseIocPrice(midPx, tob?.bid ?? null, tob?.ask ?? null, slip, isBuy);
      // intent.size is in USD notional; convert to base units
      const usd = Number(intent.size);
      if (!usd || Number.isNaN(usd)) {
        return { status: 'failed', description: 'Invalid USD size for open_position' };
      }
      const qty = usd / px;
      if (!(qty > 0)) {
        return { status: 'failed', description: 'Computed quantity is zero; increase USD size.' };
      }
      const sizeStr = this.formatDecimal(qty, asset.szDecimals);
      const priceStr = this.formatDecimal(px, 6);

      // Available to trade guard (best-effort)
      await this.guardAvailableToTrade(info, String(request.wallet.address), symbol, qty);

      await this.ensureAgentAndBuilder(exch);

      const chunked = this.isChunkingEnabled();
      let result: SignAndSendResult;
      if (chunked) {
        result = await this.executeChunkedOrders(exch, asset.id, isBuy, px, qty, asset.szDecimals, false);
      } else {
        result = await this.placeOrder(exch, asset.id, isBuy, px, qty, asset.szDecimals, false);
      }
      this.recordHlMetric(symbol, Date.now() - t0, result.status === 'success', result.description);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Hyperliquid trade failed: ${message}`, error);
      this.recordHlMetric('unknown', Date.now() - t0, false, message);
      return { status: 'failed', description: `Hyperliquid trade failed: ${message}` };
    } finally {
      this.releaseHlLock(lockKey);
    }
  }

  private async getHyperliquidAssetMeta(info: InfoClient, symbol: string): Promise<{ id: number; szDecimals: number; maxLeverage: number } | null> {
    const now = Date.now();
    if (this.hlAssetCache && this.hlAssetCache.exp > now) {
      const hit = this.hlAssetCache.map.get(symbol.toUpperCase());
      return hit ?? null;
    }
    try {
      const meta = await this.retry(async () => await info.meta());
      const map = new Map<string, { id: number; szDecimals: number; maxLeverage: number }>();
      meta.universe.forEach((u: any, idx: number) => {
        const name = String(u.name || '').toUpperCase();
        if (!name) return;
        const szDecimals = Number(u.szDecimals ?? 2);
        const maxLev = Number(u.maxLeverage ?? 50);
        map.set(name, { id: idx, szDecimals, maxLeverage: maxLev });
      });
      this.hlAssetCache = { exp: now + 10 * 60_000, map };
      return map.get(symbol.toUpperCase()) ?? null;
    } catch (e) {
      this.logger.error(`Failed to fetch Hyperliquid meta: ${(e as Error).message}`);
      return null;
    }
  }

  private async getHyperliquidPosition(info: InfoClient, userAddress: string): Promise<Array<{ coin: string; szi: string }>> {
    try {
      const data = await this.retry(async () => await info.webData2({ user: userAddress as `0x${string}` }));
      const positions = (data?.clearinghouseState?.assetPositions ?? []) as Array<any>;
      const mapped = positions
        .map((p) => ({ coin: p?.position?.coin as string, szi: p?.position?.szi as string }))
        .filter((p) => p.coin && p.szi);
      return mapped;
    } catch (e) {
      this.logger.warn(`Failed to fetch HL positions: ${(e as Error).message}`);
      return [];
    }
  }

  private formatDecimal(value: number, decimals: number): string {
    if (!Number.isFinite(value)) return '0';
    const factor = Math.pow(10, Math.max(0, decimals));
    return (Math.floor(value * factor) / factor).toFixed(decimals);
  }

  private async getTopOfBook(info: InfoClient, symbol: string): Promise<{ bid: number | null; ask: number | null } | null> {
    try {
      const book = await this.retry(async () => await info.l2Book({ coin: symbol as any, nSigFigs: 2 }));
      const bids = book.levels[0];
      const asks = book.levels[1];
      const bestBid = bids?.length ? Number(bids[0].px) : null;
      const bestAsk = asks?.length ? Number(asks[0].px) : null;
      return { bid: bestBid, ask: bestAsk };
    } catch {
      return null;
    }
  }

  private chooseIocPrice(mid: number, topBid: number | null, topAsk: number | null, slip: number, isBuy: boolean): number {
    // Dynamic micro-buffer: configurable caps and multiplier
    const minBps = Number(this.configService.get<string>('HL_MICRO_BUFFER_MIN_BPS') ?? '5');
    const maxBps = Number(this.configService.get<string>('HL_MICRO_BUFFER_MAX_BPS') ?? '20');
    const spreadMult = Number(this.configService.get<string>('HL_SPREAD_MULTIPLIER') ?? '0.5');
    let micro = minBps / 10000; // default min bps
    if (topBid && topAsk && topAsk > 0 && mid > 0) {
      const spread = (topAsk - topBid) / mid;
      if (Number.isFinite(spread) && spread > 0) {
        const fromSpread = spread * spreadMult;
        const min = Math.min(minBps, maxBps) / 10000;
        const max = Math.max(minBps, maxBps) / 10000;
        micro = Math.min(max, Math.max(min, fromSpread));
      }
    }
    const base = isBuy ? mid * (1 + slip) : mid * (1 - slip);
    if (isBuy && topAsk) return Math.max(base, topAsk * (1 + micro));
    if (!isBuy && topBid) return Math.min(base, topBid * (1 - micro));
    return base;
  }

  private computeAdaptiveSlippage(topBid: number | null, topAsk: number | null, intentSlip?: number): number {
    const defaultSlip = Number(this.configService.get<string>('HL_DEFAULT_SLIPPAGE') ?? '0.003');
    if (Number.isFinite(Number(intentSlip))) return Number(intentSlip);
    if (topBid && topAsk && topAsk > 0 && topBid > 0) {
      const spread = (topAsk - topBid) / ((topAsk + topBid) / 2);
      if (Number.isFinite(spread) && spread > 0) {
        const mult = Number(this.configService.get<string>('HL_SPREAD_TO_SLIPPAGE_MULT') ?? '1');
        const minBps = Number(this.configService.get<string>('HL_SLIPPAGE_MIN_BPS') ?? '0');
        const maxBps = Number(this.configService.get<string>('HL_SLIPPAGE_MAX_BPS') ?? '0');
        let slip = Math.max(defaultSlip, spread * mult);
        if (maxBps > 0) slip = Math.min(slip, maxBps / 10000);
        if (minBps > 0) slip = Math.max(slip, minBps / 10000);
        return slip;
      }
    }
    return defaultSlip;
  }

  // Simple in-memory HL lock per user-symbol
  private hlLocks = new Map<string, number>();
  private acquireHlLock(key: string): boolean {
    if (this.hlLocks.has(key)) return false;
    this.hlLocks.set(key, Date.now());
    return true;
  }
  private releaseHlLock(key: string) {
    this.hlLocks.delete(key);
  }

  private async enforceHlPolicy(sessionKeyId: number, intent: any, symbol: string): Promise<SignAndSendResult | null> {
    try {
      const sk = await this.sessionKeyRepository.findOne({ where: { id: sessionKeyId } });
      const perms = (sk?.permissions as SessionKeyPermissions | undefined) ?? undefined;
      if (!perms) return null;
      // actions check (matches API-side behavior)
      if (perms.actions?.length && !perms.actions.includes(intent.type)) {
        return { status: 'failed', description: `Session key does not permit ${intent.type}.` };
      }
      // HL-specific extensions: allowed markets and per-trade USD cap
      const anyPerms = perms as any;
      const allowedMarkets: string[] | undefined = anyPerms.hlAllowedMarkets;
      if (Array.isArray(allowedMarkets) && allowedMarkets.length) {
        const set = new Set(allowedMarkets.map((m) => String(m).toUpperCase()));
        if (!set.has(symbol.toUpperCase())) {
          return { status: 'failed', description: `Market ${symbol} not permitted by session key policy.` };
        }
      }
      if (intent.type === 'open_position') {
        const maxUsd: number | undefined = Number(anyPerms.hlMaxUsdPerTrade ?? NaN);
        if (Number.isFinite(maxUsd)) {
          const usd = Number(intent.size);
          if (!Number.isFinite(usd) || usd <= 0) return { status: 'failed', description: 'Invalid USD size for open_position.' };
          if (usd > (maxUsd as number)) {
            return { status: 'failed', description: `Trade size ${usd} exceeds session key cap ${maxUsd}.` };
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private resolveMarketSymbol(market: string): string {
    const raw = this.configService.get<string>('HL_MARKET_ALIASES');
    if (raw) {
      try {
        const map = JSON.parse(raw) as Record<string, string>;
        const hit = map[market.toLowerCase()];
        if (hit) return String(hit).toUpperCase();
      } catch {}
    }
    return String(market).toUpperCase();
  }

  private async guardAvailableToTrade(info: InfoClient, user: string, symbol: string, qtyBase: number): Promise<void> {
    try {
      const a = await this.retry(async () => await info.activeAssetData({ user: user as any, coin: symbol }));
      const avail = a?.availableToTrade as [string, string] | undefined;
      if (avail && avail.length === 2) {
        const n0 = Number(avail[0]);
        const n1 = Number(avail[1]);
        const cap = [n0, n1].filter((x) => Number.isFinite(x) && x >= 0);
        if (cap.length) {
          const maxAvail = Math.max(...cap);
          if (qtyBase > maxAvail) {
            throw new Error(`Requested size exceeds available to trade. qty=${qtyBase} > max=${maxAvail}`);
          }
        }
      }
      const mts = (a as any)?.maxTradeSzs as [string, string] | undefined;
      if (mts && mts.length === 2) {
        const m0 = Number(mts[0]);
        const m1 = Number(mts[1]);
        const caps = [m0, m1].filter((x) => Number.isFinite(x) && x > 0);
        if (caps.length) {
          const maxSz = Math.max(...caps);
          if (qtyBase > maxSz) {
            throw new Error(`Requested size exceeds max trade size. qty=${qtyBase} > max=${maxSz}`);
          }
        }
      }
    } catch (e) {
      // best-effort: throw only on explicit exceed; otherwise continue
      if (e instanceof Error && e.message.includes('exceeds available')) throw e;
      if (e instanceof Error && e.message.includes('exceeds max trade size')) throw e;
      this.logger.debug(`availableToTrade check skipped: ${(e as Error).message}`);
    }
  }

  private async ensureAgentAndBuilder(exch: ExchangeClient) {
    const agent = this.configService.get<string>('HL_AGENT_ADDRESS');
    const agentName = this.configService.get<string>('HL_AGENT_NAME') || 'copil';
    const builder = this.configService.get<string>('HL_BUILDER_ADDRESS');
    const maxFee = this.configService.get<string>('HL_MAX_FEE_RATE'); // e.g. "0.01%"
    if (agent && !this.hlOneShotFlags.agentApproved) {
      try {
        await this.retry(async () => await exch.approveAgent({ agentAddress: agent as any, agentName }));
        this.hlOneShotFlags.agentApproved = true;
        this.logger.log(`HL agent approved: ${agent}`);
      } catch (e) {
        this.logger.warn(`HL approveAgent failed: ${(e as Error).message}`);
      }
    }
    if (builder && maxFee && !this.hlOneShotFlags.builderFeeApproved) {
      try {
        await this.retry(async () => await exch.approveBuilderFee({ builder: builder as any, maxFeeRate: maxFee } as any));
        this.hlOneShotFlags.builderFeeApproved = true;
        this.logger.log(`HL builder fee approved: ${builder} @ ${maxFee}`);
      } catch (e) {
        this.logger.warn(`HL approveBuilderFee failed: ${(e as Error).message}`);
      }
    }
  }

  private async retry<T>(fn: () => Promise<T>, attempts = 2, baseDelayMs = 150): Promise<T> {
    let last: any;
    for (let i = 0; i <= attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (i === attempts) break;
        const jitter = Math.floor(Math.random() * 50);
        await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1) + jitter));
      }
    }
    throw last;
  }

  private isChunkingEnabled(): boolean {
    return (this.configService.get<string>('HL_CHUNK_ENABLED') ?? 'false') === 'true';
  }

  private getChunkingConfig(midPx: number): { maxOrders: number; targetUsd: number; sleepMs: number } {
    const maxOrders = Math.max(1, Number(this.configService.get<string>('HL_CHUNK_MAX_ORDERS') ?? '3'));
    const targetUsd = Math.max(0, Number(this.configService.get<string>('HL_CHUNK_TARGET_USD') ?? '0'));
    const sleepMs = Math.max(0, Number(this.configService.get<string>('HL_CHUNK_SLEEP_MS') ?? '100'));
    return { maxOrders, targetUsd, sleepMs };
  }

  private async executeChunkedOrders(
    exch: ExchangeClient,
    assetId: number,
    isBuy: boolean,
    px: number,
    totalQty: number,
    szDecimals: number,
    reduceOnly: boolean,
  ): Promise<SignAndSendResult> {
    const { maxOrders, targetUsd, sleepMs } = this.getChunkingConfig(px);
    let chunks = maxOrders;
    if (targetUsd > 0) {
      const targetQty = targetUsd / px;
      chunks = Math.max(1, Math.ceil(totalQty / targetQty));
    }
    chunks = Math.min(chunks, 20); // hard cap
    const qtyPer = totalQty / chunks;
    let remaining = totalQty;
    for (let i = 0; i < chunks; i++) {
      const q = i === chunks - 1 ? remaining : qtyPer;
      const res = await this.placeOrder(exch, assetId, isBuy, px, q, szDecimals, reduceOnly);
      if (res.status !== 'success') return res;
      remaining -= q;
      if (sleepMs > 0 && i < chunks - 1) await new Promise((r) => setTimeout(r, sleepMs));
    }
    return { status: 'success', description: 'Chunked orders executed.' };
  }

  private async placeOrder(
    exch: ExchangeClient,
    assetId: number,
    isBuy: boolean,
    px: number,
    qty: number,
    szDecimals: number,
    reduceOnly: boolean,
  ): Promise<SignAndSendResult> {
    const sizeStr = this.formatDecimal(qty, szDecimals);
    const priceStr = this.formatDecimal(px, 6);
    const res = await this.retry(async () => await exch.order({
      orders: [
        { a: assetId, b: isBuy, p: priceStr, s: sizeStr, r: reduceOnly, t: { limit: { tif: 'Ioc' } } },
      ],
      grouping: 'na',
    }));
    const status = res.response.data.statuses?.[0] as any;
    if (status?.filled || status?.resting) {
      const txh = status?.filled?.oid ? String(status.filled.oid) : undefined;
      return { status: 'success', txHash: txh, description: 'Order executed.' };
    }
    const err = status?.error ? String(status.error) : 'Unknown order result';
    return { status: 'failed', description: `Order failed: ${err}` };
  }

  private recordHlMetric(symbol: string, latencyMs: number, ok: boolean, lastError?: string) {
    this.hlMetrics.total += 1;
    if (ok) this.hlMetrics.success += 1; else this.hlMetrics.failed += 1;
    if (!ok && lastError) this.hlMetrics.lastError = lastError;
    const key = symbol.toUpperCase();
    const prev = this.hlMetrics.perSymbol.get(key) ?? { total: 0, success: 0, failed: 0, avgLatencyMs: 0 };
    const nextTotal = prev.total + 1;
    const nextSuccess = prev.success + (ok ? 1 : 0);
    const nextFailed = prev.failed + (ok ? 0 : 1);
    const nextAvg = prev.avgLatencyMs + (latencyMs - prev.avgLatencyMs) / nextTotal;
    this.hlMetrics.perSymbol.set(key, { total: nextTotal, success: nextSuccess, failed: nextFailed, avgLatencyMs: nextAvg });
    this.logger.debug(`HL metrics [${key}]: total=${nextTotal} ok=${nextSuccess} fail=${nextFailed} p95~n/a avg=${nextAvg.toFixed(1)}ms`);
  }

  private async signAndSendEoa(request: SignAndSendRequest): Promise<SignAndSendResult> {
    const chainName = (request.metadata?.chain as string)?.toLowerCase();
    if (!chainName) {
      return { status: 'failed', description: 'Chain name not provided in metadata.' };
    }
    if (!request.transaction) {
      return { status: 'failed', description: 'Missing transaction payload for EOA signing.' };
    }

    if (chainName === SOLANA_CHAIN_NAME) {
      return this.signAndSendSolana(request);
    } 

    // Handle EVM-based EOA chains (Sei, Hyperliquid, etc.)
    const chain = chainMap[chainName];
    if (chain) {
      return this.signAndSendEoaEvm(chainName, chain, request);
    }

    return { status: 'failed', description: `Unsupported EOA chain: ${chainName}` };
  }


  private async signAndSendEoaEvm(
    chainName: string,
    chain: Chain,
    request: SignAndSendRequest,
  ): Promise<SignAndSendResult> {
    this.logger.log(`Executing an EOA transaction on EVM chain ${chainName}`);
    const { sessionKeyId } = request;
    const tx = request.transaction!;

    const sessionKey = this.getSessionKey(sessionKeyId);
    if (!sessionKey) {
      return { status: 'failed', description: `Private key for session key ID ${sessionKeyId} not found.` };
    }

    try {
      const walletClient = createWalletClient({
        account: privateKeyToAccount(sessionKey),
        chain: chain,
        transport: http(this.getRpcUrl(chainName)),
      });

      this.logger.log(`Sending transaction via EOA signer to ${tx.to} on ${chainName}`);

      const txHash = await walletClient.sendTransaction({
        to: tx.to as `0x${string}`,
        data: tx.data,
        value: tx.value ? parseEther(tx.value) : undefined,
      });

      this.logger.log(`${chainName} EOA transaction successful with hash: ${txHash}`);
      return { status: 'success', txHash, description: `${chainName} EOA transaction successfully sent.` };

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`${chainName} EOA transaction failed: ${message}`, error);
      return { status: 'failed', description: `${chainName} EOA transaction failed: ${message}` };
    }
  }

  private async signAndSendSolana(request: SignAndSendRequest): Promise<SignAndSendResult> {
    this.logger.log('Executing an EOA transaction on Solana');
    const { sessionKeyId } = request;
    const chainName = SOLANA_CHAIN_NAME;
    const quote = (request.metadata as any)?.quote;

    const sessionKey = this.getSessionKeyBytes(sessionKeyId);
    if (!sessionKey) {
      return { status: 'failed', description: `Private key for session key ID ${sessionKeyId} not found or invalid.` };
    }

    if (quote?.serializedTx) {
      // Handle Jupiter swap transaction
      try {
        const connection = new solana.Connection(this.getRpcUrl(chainName), 'confirmed');
        const signer = solana.Keypair.fromSecretKey(sessionKey);

        const transaction = solana.Transaction.from(Buffer.from(quote.serializedTx, 'base64'));
        
        // The transaction from Jupiter is already mostly constructed.
        // We just need to sign it.
        transaction.sign(signer);

        const txHash = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(txHash);

        this.logger.log(`Solana swap transaction successful with hash: ${txHash}`);
        return { status: 'success', txHash, description: `Solana swap transaction successfully sent.` };

      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Solana swap transaction failed: ${message}`, error);
        return { status: 'failed', description: `Solana swap transaction failed: ${message}` };
      }
    } else {
        // Fallback or error for non-swap intents if needed, for now we only support swaps via Jupiter
        return { status: 'failed', description: 'Only Solana swaps via Jupiter are currently supported.' };
    }
  }

  private async signAndSendSmartAccount(
    request: SignAndSendRequest,
  ): Promise<SignAndSendResult> {
    const { userId, sessionKeyId, wallet } = request;
    const transaction = request.transaction!;
    if (!transaction) {
      return { status: 'failed', description: 'Missing transaction payload for Smart Account signing.' };
    }
    const chainName = (request.metadata?.chain as string) ?? 'base';
    const chain = chainMap[chainName.toLowerCase()];

    if (!wallet || !wallet.smartAccountAddress) {
      return { status: 'failed', description: `Smart Account for user ${userId} on chain ${chainName} not found.` };
    }

    const sessionKey = this.getSessionKey(sessionKeyId);
    if (!sessionKey) {
      return { status: 'failed', description: `Private key for session key ID ${sessionKeyId} not found.` };
    }

    try {
      const publicClient = createPublicClient({ 
        transport: http(this.getRpcUrl(chainName)),
        chain: chain, // Add chain to publicClient
      });
      const sessionKeySigner = privateKeyToAccount(sessionKey);

      const safeAccount = await toSafeSmartAccount({
        client: publicClient, 
        owners: [sessionKeySigner], 
        version: '1.4.1', 
        entryPoint: { address: entryPoint06Address, version: '0.6' },
        address: wallet.smartAccountAddress as `0x${string}`,
      });

      const usePaymaster = this.configService.get<string>('PAYMASTER_ENABLED') === 'true';
      const baseConfig: any = { account: safeAccount, chain, bundlerTransport: this.bundlerClient.getTransport(chain) };

      if (usePaymaster) {
        try {
          baseConfig.paymasterTransport = this.paymasterClient.getTransport(chain);
          this.logger.log(`Paymaster transport configured for ${chainName}`);
        } catch (e) {
          this.logger.warn(`Paymaster disabled for ${chainName}: ${(e as Error).message}`);
        }
      }

      const smartAccountClient = createSmartAccountClient(baseConfig);

      this.logger.log(`Sending UserOperation via Smart Account ${safeAccount.address} on ${chainName}`);

      const userOpHash = await smartAccountClient.sendTransaction({
        account: safeAccount,
        chain,
        to: transaction.to as `0x${string}`,
        data: transaction.data,
        value: transaction.value ? parseEther(transaction.value) : undefined,
      });

      this.logger.log(`UserOperation successful with hash: ${userOpHash}`);

      return {
        status: 'success',
        txHash: userOpHash,
        description: `UserOperation successfully sent on ${chainName}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending UserOperation for session key ${sessionKeyId}: ${message}`, error);
      return { status: 'failed', description: `UserOperation failed: ${message}` };
    }
  }

  private getSessionKey(sessionKeyId: number): Hex | undefined {
    const key = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY`);
    if (key) {
      return key.startsWith('0x') ? (key as Hex) : `0x${key}`;
    }
    const fallback = this.configService.get<string>('SESSION_KEY_PRIVATE_KEY');
    if (fallback) {
      return fallback.startsWith('0x') ? (fallback as Hex) : `0x${fallback}`;
    }
    return undefined;
  } 
  
  private getSessionKeyBytes(sessionKeyId: number): Uint8Array | undefined {
    // 1. Try to get the key as a JSON byte array
    const keyBytes = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY_BYTES`);
    if (keyBytes) {
        try {
            this.logger.log('Found _BYTES session key for Solana');
            return Uint8Array.from(JSON.parse(keyBytes));
        } catch (e) {
            this.logger.error('Failed to parse SESSION_KEY_..._PRIVATE_KEY_BYTES');
            return undefined;
        }
    }

    // 2. Fallback to a Base58 encoded string
    const keyB58 = this.configService.get<string>(`SESSION_KEY_${sessionKeyId}_PRIVATE_KEY_B58`);
    if (keyB58) {
        try {
            this.logger.log('Found _B58 session key for Solana');
            return bs58.decode(keyB58);
        } catch (e) {
            this.logger.error('Failed to decode Base58 private key for Solana');
            return undefined;
        }
    }

    this.logger.warn(`No valid _BYTES or _B58 private key found for session key ID ${sessionKeyId}`);
    return undefined;
  }

  private getRpcUrl(chain: string): string {
    const key = `RPC_URL_${chain.toUpperCase()}`;
    const url = this.configService.get<string>(key) ?? this.configService.get<string>('RPC_URL');
    if (!url) {
      throw new Error(`RPC URL for chain ${chain} not configured.`);
    }
    return url;
  }
}
