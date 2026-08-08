# Threat model

Protected assets are hook-custodied V4 positions, PoolManager WETH claims backing Programmable fees, rebates and rewards, and the permanently locked initial V4/WETH liquidity position. Valuable state includes remaining cost basis, mature shares, intent nonces, cumulative fee remainders, reward distribution dust, and the exact canonical PoolKey.

Adversaries include arbitrary routers, callers attempting to spend another payer's allowance, forged/replayed/expired intents, position impersonators, fee-fragmenting traders, alternate PoolKeys or PoolManagers, permission-mask collisions, malicious deployment salts, donation griefers, claim redirectors, wallet sybils, reentrant recipients, MEV actors, and unsupported token behavior.

## Trust and authority boundaries

- Only canonical PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` may call hook and launcher callbacks.
- Verified hook data additionally requires the immutable trusted router. The staged intent is exact, nonce-bound, and single-use.
- The hook accepts only its one registered V4/WETH PoolKey. Its exact permission-mined address must encode mask `0x20cc`.
- The one-shot launcher requires `payer == msg.sender` before deployment or transfers, deploys router before factory before hook, then initializes and funds the pool atomically. An unauthorized payer, replay, wrong salt, child address, dependency, amount cap, callback delta, or settlement reverts everything without consuming payer balances or allowances.
- The launcher permanently owns the initial position and exposes no path to remove liquidity, collect position fees, transfer ownership, rescue assets, upgrade code, or make arbitrary calls.
- Programmable’s 10-bps liability is immutable, segregated, and claimable only by `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`; no mutable stored recipient or project path can redirect it.

## Accounting invariants

Specified-quote fees use bounded positive before-swap deltas; unspecified-quote fees and verified-buy custody use actual after-swap deltas. Unsupported fills and sign or amount mismatches revert. Claims reduce recorded liabilities before burning PoolManager claims and taking WETH. Position withdrawals checkpoint rewards, reduce shares/tokens/basis, transfer exact V4, and recheck custody.

```text
accountedQuoteClaims * 1e27
  == platformLiability * 1e27
   + totalRebateLiability * 1e27
   + totalRewardScaledLiability

PoolManager WETH claims >= accountedQuoteClaims
V4.balanceOf(hook) >= totalPositionTokens
initialTokens = sold + withdrawn + remaining
initialBasis = soldBasis + withdrawnBasis + remainingBasis
```

## Residual risks

The attributable Codex automated review record covers v4 delta semantics, exact-output behavior on ordinary routes, composite rounding and scaled dust, custody, authorization, settlement, rollback, permanent liquidity, claims, exits, and code-level failure paths against the unchanged executable baseline. Maintainer verification of its identity, hashes, witnesses, and finding dispositions remains required. The record is not a third-party human audit or security guarantee.

Residual product risks include sybil splitting, router compatibility, MEV, pinned-price staleness, launch funding, dependency-code drift, and the deliberate inability to recover accidental unsupported transfers. V1 is intentionally limited to the existing fixed V4/WETH pair and has no generic token-deployment path. The existing V4 token is bound as fixed-supply, non-rebasing, non-fee-on-transfer behavior; any contradictory onchain observation must halt launch.

Platform quoting, indexing, reorg recovery, monitoring, registry, routing-provider approval, and final runtime/source verification are outside the submitted contract system and remain separate maintainer-owned gates. Builder-declared tests are evidence for review, not an audit or production guarantee.
