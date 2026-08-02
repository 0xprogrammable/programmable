# Proposal

## Outcome

OmniBurn is a reusable Programmable Uniswap v4 launch model. A creator launches one immutable fixed-supply token, chooses a visible whole-number canonical-pool fee from 1% through 10%, and binds one destination chain, destination token, reviewed burn adapter, executor and maximum batch size.

The fee is inclusive. Exactly 0.10% of executed gross ETH quote volume belongs to the immutable Programmable owner. The remainder, from 0.90% through 9.90%, belongs only to the PoolId-scoped cross-chain buyback-and-burn escrow.

The reference package uses a non-deployed fixed-supply `OBURN` test token, a canonical Ethereum ETH/token pool, a static 0.30% LP fee, tick spacing 60 and a one-percent selected hook fee. Fee collection remains `pending-hook-integration` until exact source and tests exist. It does not require or claim a live launch.

## Architecture

One immutable hook instance admits one canonical PoolKey. Only `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta` and `afterSwapReturnDelta` are enabled, producing permission mask `0x00cc`. The quadrant-dependent return-delta path charges ETH on all direction and exactness combinations. The hook cannot initiate a same-pool swap.

The project fee remains in a source escrow. Cross-chain work never executes inside a PoolManager callback. The creator records an executor wallet and may later replace only that executor. The executor may click a manual Bridge and Burn action or run the supplied self-hosted worker. It pays gas and supplies the batch quote, but never receives fee principal.

The source escrow accepts only typed deBridge order parameters bound to the immutable destination configuration, exact PoolId, amount cap, minimum output, nonce and expiry. No target or calldata is user-controlled. The reference destination is Base through the officially documented DLN destination and external-call adapter. A destination burn adapter must validate the complete order domain instead of trusting the bridge caller alone.

## Value flow

1. A successful canonical-pool swap settles through PoolManager and accrues the inclusive platform and project amounts.
2. The Programmable liability is keyed by PoolId, currency and immutable owner and may be claimed only by that owner.
3. The project liability stays in the PoolId source escrow until the current executor submits one bounded batch.
4. deBridge fulfills the exact destination amount and retains non-atomic hook output until the typed burn action executes.
5. Only the destination burn receipt changes a batch from pending to burned.
6. An expired cancellation returns value only to the predetermined source escrow or recovery adapter, never to the executor.

## Worked examples

For 1 ETH of executed gross quote volume at the one-percent reference setting:

- total hook fee: `1 * 1% = 0.01 ETH`
- Programmable: `1 * 0.10% = 0.001 ETH`
- burn escrow: `1 * 0.90% = 0.009 ETH`
- residual quote amount before separate LP-fee treatment: `0.99 ETH`

For 1 ETH of executed gross quote volume at the maximum ten-percent setting:

- total hook fee: `0.10 ETH`
- Programmable: `0.001 ETH`
- burn escrow: `0.099 ETH`
- residual quote amount before separate LP-fee treatment: `0.90 ETH`

For an exact-output request whose user-visible net is 1 ETH at the one-percent setting, the implementation must gross up the quote side. Ignoring integer rounding for illustration, gross quote output is `1 / 0.99 = 1.010101... ETH`; the total hook amount is `0.010101... ETH`, of which 0.10% of gross quote volume is platform liability and 0.90% is burn liability. The final caller delta must still deliver exactly 1 ETH or revert. Integer implementation rounds against fee recipients and attributes dust to the same PoolId.

If 0.009 ETH is available and a proposed 0.005 ETH DLN order reverts during creation, the liability remains 0.009 ETH and no active batch is recorded. A fulfilled destination order is still reported as pending until the burn receipt reconciles.

## Authorities and failure

The launch creator can replace only the executor. The executor can submit or retry typed bounded batches and controls quote timing, creating a disclosed poor-price risk. Immutable batch caps bound each attempt. Neither role can claim platform value, change fee, redirect escrow, change destination or sweep historical liabilities.

Bridge, API, worker, RPC and destination failures never block swaps or standard liquidity exits. Each PoolId permits one active source batch and one pending destination outcome. Failed work remains retryable or follows the immutable expiry and recovery path.

## Product surfaces

The proposed product includes launch configuration, a manual Bridge and Burn action, a simple creator-operated worker, source and destination status indexing, fee and batch accounting, burn receipts and monitoring. It supplies no swap client and claims no Uniswap routing, Hooklist, deployment or availability.

## Architecture-review blocker

Programmable schema 1.3.0 currently requires `capabilities.crossChain.destination.chainId` to equal the launch `target.chainId`. OmniBurn intentionally has an Ethereum canonical launch pool as the source and a different reviewed destination chain. The submission preserves the real direction and therefore receives `CROSS_CHAIN_DESTINATION_CHAIN_MISMATCH` rather than falsifying either chain.

Maintainers need to choose how an outbound source-chain launch binds its destination adapter or companion-chain package. This is a schema and architecture-review question, not a claim that the mechanism is unsafe. Solidity implementation remains paused until that question is resolved and preflight permits prototype work.
