# Threat model

## Assets at risk

- Canonical-pool trader deltas affected by the inclusive fee
- PoolId-scoped Programmable and burn liabilities
- ETH committed to active deBridge orders
- Destination tokens held pending burn execution
- Creator executor gas funds

## Trust boundaries

PoolManager callback authentication, canonical PoolId admission, source escrow custody, creator-controlled executor timing, deBridge source and destination contracts, destination hook engine, chain-specific burn adapter, RPC/indexer state and the optional worker are separate boundaries.

The executor is trusted for quote quality and timing. It is not trusted with custody, destination selection or arbitrary calls. deBridge caller identity is insufficient authorization because anyone may create and fill arbitrary DLN orders. Destination execution must bind the order id, source escrow, both domains, model id, PoolId, destination token, exact amount, payload hash, nonce and expiry.

## Principal threats and controls

- **Fee bypass:** all four swap quadrants use the canonical hook and final executed gross ETH basis; same-pool self-swaps are forbidden.
- **Return-delta insolvency:** every callback settles touched PoolManager deltas to zero and liabilities remain keyed by PoolId, currency and beneficiary.
- **Executor compromise:** destination and adapter are immutable; one active batch and immutable batch cap limit economic loss from poor timing or quotes.
- **Executor loss:** creator may replace the executor and resume manually; trading and liquidity exits remain independent.
- **Arbitrary execution:** source and destination accept only typed reviewed methods and immutable targets. User-controlled target, selector and calldata are forbidden.
- **Replay or forged order:** consume the exact order id and PoolId nonce before burn interaction and retain replay state after cleanup.
- **Bridge spoofing:** repeat domain and payload validation even when the documented DLN caller is correct.
- **Partial or stale fulfillment:** require full declared output and finite expiry; never emit a burn receipt for partial, stale or pending output.
- **Reentrancy:** commit nonce and active state before source calls; consume destination order state before the burn call; revert atomically.
- **Reorg/indexer error:** use finalized per-chain cursors, block-hash checkpoints, rollback and confirmed contract reconciliation.
- **Cancellation theft:** cancellation authority and recovery destination are immutable and cannot resolve to the executor wallet.
- **Alternative pool confusion:** only the factory-recorded PoolKey is canonical; alternative pools do not inherit fee or burn claims.

## Residual risks

The creator executor can accept a poor but structurally valid quote. deBridge deployments may upgrade or fail. Destination tokens may expose non-standard, pause, blacklist or burn behavior. Cross-chain output can remain pending. Return-delta accounting and exact-output gross-up require specialist review. A beta record is not an audit or deployment approval.

## Current blocker

The validator models cross-chain consumption on the launch target chain and rejects OmniBurn's intentional Ethereum-source to Base-destination reference direction. No contract implementation is claimed until maintainers establish the correct outbound-chain representation.
