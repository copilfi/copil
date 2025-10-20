# ADR-003: Sei Bridge Integration (Design)

Status: Accepted

## Context
Copil uses a chain abstraction client that delegates EVM quotes/balances to OneBalance and handles Sei via a direct adapter. Swaps on Sei (Dragonswap) are simulated and return an executable `transactionRequest` for non-custodial signing. Bridging EVM → Sei is implemented via Axelar gateway contracts with executable approval + `sendToken` calls.

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
- Use Axelar-based EVM gateway calls for Sei bridges. The client composes approval + `sendToken` transactions and returns an executable `transactionRequest`.
- Only accept flows that return an executable on-chain `transactionRequest` (no custodial deposit flows).
- Fail fast with a clear error when configuration is incomplete (e.g., gateway address missing).

## Implementation Plan
1) Implement `AxelarBridgeClient` to construct approval + `sendToken` transactions.
2) Add gateway addresses via `AXELAR_GATEWAY_ADDRESS_<CHAIN>` environment variables.
3) Return `quote` with id/fromAmount/toAmount/transactionRequest; fees/estimates can be enriched later.
4) If configuration is incomplete, throw with actionable messages.

## Rollout
Implemented (Phase 2). Future work: expand asset/routes and fee estimation.
