# Threat model

## Launch assets and authority

- The launch-session wallet supplies at most 100,000 USDC, receives unused OPEN/USDC, and becomes the immutable project fee owner, vault issuer, and NAV signer.
- `OpenHoursToken` creates exactly 1,000,000,000 OPEN once. It has no owner, mint, pause, blacklist, tax, rescue, or upgrade path.
- PoolManager holds AMM balances. PositionManager represents liquidity as an NFT minted directly to `0x000000000000000000000000000000000000dEaD`; liquidity removal is intentionally impossible.
- EpochRedemptionVault separately holds pre-funded USDC and queued OPEN. Pool liquidity never backs vault redemptions.

The launcher checks code hashes for its four constructor dependencies and cross-checks PositionManager's PoolManager and Permit2 identities. The launch manifest additionally binds StateView, V4Quoter, and Universal Router by chain, address, runtime, source/runtime identity, and exact role. Runtime drift is a fail-closed preflight condition.

## Atomic graph and CREATE2 threats

The canonical compiler mines the direct hook target for exact `0x20cc` permission bits. This avoids a circular dependency between a factory-created hook, launcher address, token address, and vault address. The hook derives and stores OPEN during one-shot canonical registration rather than accepting it in constructor init code.

The factory initializer is intentionally permissionless and one-shot. It is safe only when factory deployment and initializer execution occur in the same generic-adapter transaction. A separately deployed uninitialized factory can be front-run and must never be used. The launch graph binds the initializer's address word to the deterministic launcher target and the factory consumes that authorization during registration.

The wallet's exact USDC approval is a pre-launch transaction and is not rolled back by launch failure. Failure retains no wallet funds, but leaves the unused allowance available to the same predicted launcher address. The wallet must retry only the identical reviewed launch or revoke the allowance.

Any dependency mismatch, wrong hook binding/permission bits, child deployment failure, registration failure, pool initialization failure, USDC transfer discrepancy, liquidity mint failure, custody mismatch, uncleared approval, residual PositionManager balance, or post-state mismatch reverts the outer launch transaction.

## Hook and fee boundary

Only the immutable PoolManager may enter callbacks, and every callback verifies the exact canonical PoolKey. Hook data is ignored. The hook never calls the vault, signer, API, or oracle during a swap and exposes no same-pool swap path.

Registration is one-shot. It validates address-sorted OPEN/USDC, the dynamic fee flag, tick spacing 60, vault assets/hook binding, and exact initial price before initializing PoolManager and writing the hardcoded 3,000-pip stored fallback. A second registration cannot reach either write.

Specified-quote partial fills revert; unspecified quote uses actual execution delta. Positive gross amounts below the fee quantum revert. Independent cumulative remainder streams prevent accepted small swaps from evading lifetime fees. Liabilities are isolated by PoolId, currency, and immutable owner and must remain covered by hook-owned PoolManager claims.

## Liquidity, price, and trading risks

The initial tick and 900,000,000 OPEN / 100,000 USDC budgets are policy choices, not an oracle price or valuation guarantee. Full-range locked liquidity cannot be rebalanced or withdrawn. Price impact, arbitrage, MEV, adverse selection, depegging, and loss of all supplied liquidity remain possible.

Public trades must use the complete PoolKey and the exact bound Router/V4Planner/Permit2 version. Users provide deadline and amount bounds. A production client must compare the V4Quoter result with current state and fail on runtime drift, stale quote, excessive slippage, missing approval, simulation failure, or reorg uncertainty. Aggregator/provider discovery is outside the launcher and must not silently substitute another router.

## NAV producer and epoch threats

No epoch exists at launch, so producer or signer failure cannot block the AMM. The production boundary is specified in `docs/NAV_PRODUCER_BOUNDARY.md`:

- issuer ledger observations are authenticated and must be no older than five minutes;
- the HSM/KMS signer key never crosses into browsers, the launch adapter, logs, or the relay;
- the relay accepts only allowlisted vault/chain/function calls and verifies the EIP-712 digest before submission;
- missing, conflicting, stale, or unauthenticated data produces no signature and no transaction;
- an outage lets the onchain report deadline pass, after which holders recover exact queued OPEN.

A compromised signer can choose only an in-band NAV for an already pre-funded epoch. A compromised issuer can stop future epochs or choose future capacity and bands but cannot mutate a live epoch or withdraw unresolved liabilities. Production must use an EIP-1271 signing identity with governed recovery; using an ordinary launch EOA concentrates funding, issuer, fee-owner, and signer compromise.

## Residual risk and status

Local tests and structural checks are not an audit. The new launcher and trade planner require independent review, exact-revision rebuild, Mainnet-fork lifecycle evidence, and runtime reconciliation. No claim is made that OPEN represents a share, external asset, legal redemption right, stable value, or issuer-backed instrument.
