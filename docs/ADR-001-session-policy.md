# ADR-001: On-Chain Session Policy for Safe Smart Accounts

Status: Proposed

## Context
Today, session keys are validated at the application layer (DB `SessionKey` + runtime checks in the executor). This protects most misuse but does not enforce limits on-chain. For a production-grade, non-custodial experience, we need on-chain policy that constrains what a leaked session key can do.

## Decision
Adopt a Safe-compatible session policy module to enforce:
- Allowed actions: swap, bridge (function selectors / contract allowlist)
- Allowed chains: enforced by deploying the Safe per chain and scoping the key
- Spend limits: per-token, per-time-window caps
- Contract allowlist/denylist: aggregators, routers, bridges

We will:
1) Use a Safe module or guard that validates userops against a policy (community modules are available; build a minimal allowlist if necessary).
2) Provision per-user Safe addresses already computed (`SmartAccountService`) and attach the policy module during activation.
3) Encode permissions from DB (`SessionKeyPermissions`) into the on-chain module configuration.
4) Maintain parity checks in the executor as defense-in-depth.

## Consequences
- On-chain enforcement reduces blast radius of key compromise.
- Adds deployment/activation flows and policy updates lifecycle.
- Requires migration path for existing users without a module.

## Rollout Plan
- Phase 1: Prototype module on testnet, attach to newly created Safes only.
- Phase 2: Migrate existing users (opt-in) with UI guidance.
- Phase 3: Make module default for all new automation keys.

