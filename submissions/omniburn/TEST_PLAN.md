# Test plan

Planned tests are not yet executed. Solidity work starts only after the outbound cross-chain schema question is resolved and preflight permits a prototype.

## Hook and launch

- Factory-only one-time initialization and exact PoolKey admission
- Hook address permission mask `0x00cc`, callback selectors and return lengths
- Fixed-supply token with no mint, tax, pause, blacklist, proxy or rescue authority
- Whole-number fee choices 1% through 10%; reject zero, fractions, 11% and reconfiguration
- Static LP fee remains separate from the inclusive hook fee
- Alternative PoolId, second initialization, direct callback and same-pool self-swap rejection

## Fee and settlement

- Both directions and exact-input/exact-output modes
- Quote asset as specified and unspecified currency paths
- Zero, one, boundary, maximum and overflow-adjacent amounts
- Partial-fill execution uses final gross ETH, not requested amount
- Exact-output gross-up, tiny amounts and rounding dust
- Native sync and settle ordering and zero deltas before unlock end
- Platform plus burn liabilities equal collected hook amount for every successful swap
- Cross-pool same-currency isolation and no netting
- Platform owner-only claims, arbitrary owner-selected claim destination and unauthorized claim rejection
- Reverting/reentrant claim recipients and historical-entitlement preservation

## Executor and source escrow

- Only current executor can dispatch; creator can replace only executor
- Lost and compromised executor scenarios
- One active batch, batch-cap boundary, fresh deadline and next nonce
- Duplicate, early, late, zero-work and repeated dispatch
- Reentrant DLN source mock and malformed/false-return external calls
- Source order revert leaves liability and active state unchanged
- Cancellation returns only to the immutable recovery destination

## Cross-chain destination

- Correct and wrong source network, source domain, source escrow, destination chain and receiver
- Correct and wrong order id, model id, PoolId, action, token, amount, payload hash, nonce and expiry
- Full fill, partial fill, delayed fill, replay and out-of-order independent order
- Forged order from the documented DLN caller
- Pending hook execution, retry, quarantine bound and expiry cancellation
- Burn adapter revert, reentrancy, false return, no balance decrease and non-standard destination token
- Solana and other non-EVM adapters require separate chain-specific suites before future model versions

## Data and operations

- Source and destination event replay reconstructs complete batch state
- Finality, reorg rollback, deterministic resync, bounded backfill and stale-state suppression
- Balance/liability solvency reconciliation at one confirmed block
- Worker idempotency, gas runway, RPC failure and manual fallback
- No status becomes burned without a confirmed destination receipt

## Required analysis

- Format, compile, warning and bytecode-size checks under pinned Foundry settings
- Unit, integration, fuzz, stateful invariant and fork tests
- Static analysis with dispositions
- Current Ethereum and Base runtime identity checks
- Independent accounting, bridge and security reviews proportional to the high-risk tier
