# ADR-002: Swap Approval Flow & Idempotency

Status: Proposed

## Context
Aggregators (e.g., 0x/1inch) return a `transactionRequest` for the swap and an `allowanceTarget` for ERC‑20 approvals. The executor currently prepares a single transaction and relies on the signer to broadcast it. Without handling approvals, swaps may revert due to insufficient allowance.

## Decision
Extend the executor to:
1) Fetch a quote and parse `allowanceTarget`.
2) Determine the owner address (Safe) for the user on the selected chain.
3) Read current allowance via `allowance(owner, spender)`; if `< amountIn`, build an `approve(spender, amountIn)` tx.
4) Send approval (UserOp 1) and, after success, send the swap (UserOp 2).
5) Record both tx hashes and enrich `TransactionLog.details` (approvalTxHash, allowanceTarget, rawQuote).

Idempotency & Safety:
- Compare allowance using BigInt token units; skip approval when sufficient.
- If approval fails, mark job failed; rely on BullMQ retry/backoff.
- Limit approval to `amountIn` (not MAX_UINT) to reduce risk.
- Native assets: skip allowance logic.

## Changes
- Types: extend `ExecutionResult` to optionally include `approvalRequest` metadata.
- Executor: inject `ConfigService` and `Wallet` repository; add `readAllowance` helper with `viem`.
- Signer: no change; sequential `sendTransaction` calls.

## Rollout Plan
- Implement on Base first; add per-chain tests.
- Validate with a sandbox aggregator; fall back to “skipped” with payload details if signer/bundler config is missing.

