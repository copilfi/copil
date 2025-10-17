# ADR-003: Sei Bridge Integration (Design)

Status: Proposed

## Context
Copil now uses a chain abstraction client that delegates EVM quotes/balances to OneBalance and handles Sei via a direct adapter. Swaps on Sei (Dragonswap) are simulated and return an executable `transactionRequest` for non-custodial signing. Bridging to/from Sei is not yet implemented.

## Goals
- Provide non-custodial bridge quotes involving Sei (Sei <-> EVM), returning an executable `transactionRequest` that the user's Safe can sign.
- Keep consistency with existing execution: API computes the quote, enqueues jobs containing `intent + quote.transactionRequest`, executor signs and broadcasts.

## Provider Options (Evaluation)
- Axelar GMP (EVM <-> Sei):
  - Pros: Mature cross-chain infra for Cosmos <-> EVM; widely used.
  - Cons: Requires composing calldata for gateway/router contracts; per-token routing nuances.
- Skip / Nitro / Other Cosmos bridges:
  - Pros: High-level APIs, routing over multiple bridges/DEXs.
  - Cons: SDK maturity and EVM-side `transactionRequest` readiness vary; may require deposit flows we do not accept.

## Decision
- Start with Axelar-based EVM gateway calls for Sei bridges, targeting a minimal set of routes and assets to validate the path.
- Only accept flows that return an executable on-chain `transactionRequest` (no custodial deposit flows).
- Fall back to “unsupported” with clear error details when a route is not expressible as a locally signable tx.

## Implementation Plan
1) Extend `SeiClient` with `getBridgeQuote(intent)`.
2) Add Axelar gateway contract config, chain IDs, and a small mapping for supported assets/routes.
3) Build `transactionRequest` via viem `encodeFunctionData`.
4) Return `quote` with id/fromAmount/toAmount/transactionRequest; enrich details later with fees.
5) If no route or an extra off-chain deposit step is required, throw with an actionable message.

## Rollout
- Phase 1: Stub implementation (throws “not implemented”), API returns 400; documents limitation.
- Phase 2: Implement a single happy-path (e.g., USDC EVM -> USDC on Sei) on testnets.
- Phase 3: Add assets/routes and error handling, then UI exposure.

