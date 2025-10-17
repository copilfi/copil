## Axelar Environment Configuration (Sei Bridge)

To enable non‑custodial bridging to/from Sei via Axelar, set the following environment variables in the services that build quotes (API) and in any worker that may need them (typically not required for executor at sign time, but safe to include):

Required per source EVM chain (at least the chain(s) you will bridge from):
- `AXELAR_GATEWAY_ADDRESS_ETHEREUM`
- `AXELAR_GATEWAY_ADDRESS_BASE`
- `AXELAR_GATEWAY_ADDRESS_ARBITRUM`
- `AXELAR_GATEWAY_ADDRESS_LINEA`

Global:
- `AXELAR_SEI_CHAIN_NAME` (default: `sei`)
- `AXELAR_TOKEN_SYMBOL_USDC` (default: `aUSDC`)
- `SEI_BRIDGE_ENABLED` (set to `true` to enable Axelar path; otherwise, bridge quotes involving Sei will fail-fast with a helpful error)

Verification tips:
- Use AxelarScan or official Axelar docs to retrieve mainnet addresses. Verify contract bytecode matches Axelar Gateway contract and the address is on the correct chain.
- Ensure the token symbol you pass (e.g., `aUSDC`) matches the gateway’s expected symbol for the asset being bridged.
- For approval to succeed, the source token in `intent.fromToken` must be the ERC‑20 contract that the user actually holds on the source chain (canonical USDC vs axlUSDC differs by route/pool availability).

Operational guidance:
- Start with a single happy path (e.g., USDC on Ethereum → USDC on Sei EVM). Once validated in a testnet/mainnet dry-run, expand to other chains/assets.
- Consider adding gas service configuration if you plan to prepay cross-chain gas via Axelar’s Gas Service contracts.

### Example (Mainnet – verify before use)

These addresses have been provided and are commonly referenced for Axelar Gateway on mainnet EVM chains. Always verify on Axelar’s official docs or AxelarScan before use:

```
AXELAR_GATEWAY_ADDRESS_ETHEREUM=0x4f4495243837681061c4743b74b3eedf548d56a5
AXELAR_GATEWAY_ADDRESS_BASE=0xe432150cce91c13a887f7d836923d5597add8e31
AXELAR_GATEWAY_ADDRESS_ARBITRUM=0xe432150cce91c13a887f7d836923d5597add8e31
AXELAR_GATEWAY_ADDRESS_LINEA=0xe432150cce91c13a887f7d836923d5597add8e31

SEI_BRIDGE_ENABLED=true
AXELAR_SEI_CHAIN_NAME=sei
AXELAR_TOKEN_SYMBOL_USDC=aUSDC
```

Note: Token symbol `aUSDC` and source token address (`intent.fromToken`) must match the exact asset being bridged for the selected route (canonical USDC vs axlUSDC may differ). Approvals are made against the source token contract.
