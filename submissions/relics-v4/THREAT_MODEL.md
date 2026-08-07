# Threat model

## Assets and value at risk

The hook custodies nothing at any time: no tokens, no ETH, no claims, no positions, no dust. A
total hook compromise could at worst corrupt future art-state writes; it cannot touch funds.
Real value lives in the pool (PoolManager accounting, owned by LP position holders) and in
holder balances of the fixed 10,000-unit ERC-20, both outside the hook's authority. The genesis
LP position NFT is held in a third-party UNCX liquidity lock (lock id 103); holder balances and
awakened Relics are independent of that position.

## Trust boundaries

- PoolManager to hook: the only caller of every callback (BaseHook restricts to the exact
  PoolManager address fixed at construction).
- Hook to PoolManager: read-only slot0 via extsload. The hook initiates no pool actions, no
  external calls, no token movements.
- Routers and traders: hookData is an optional 32-byte entropy salt with no identity and no
  financial meaning; a malicious router can at most perturb the art seed of its own swap.
- No oracle, keeper, signer, bridge, upgrade path or administrator exists anywhere.

## Custom hook boundary

All 14 permission flags are address-encoded (mask 0x1440): afterInitialize, afterAddLiquidity
and afterSwap true, everything else false, including every before-hook and all four return
delta bits, which makes amount manipulation unreachable even under a code bug. afterInitialize
validates the exact expected initial price (tick -82980) and the full canonical PoolKey and
seeds market state exactly once; the other callbacks revalidate the key and record history.
The one reachable revert family on the canonical pool is a set of uint128 cumulative-volume
overflow guards that would need roughly 3.4e16 full-supply round trips, which is not a
practical denial-of-service vector. The CREATE2 record (deterministic deployer, salt 0x1302,
init-code hash 0x8a34afea) is reproduced offline by the flagship proof test from the exact
published source.

## Token-layer boundary

The paired ERC-20's transfer coupling (LIFO NFT retirement, 16-per-transfer bound, holder-only
prepareSell above it) contains no operator authority, never modifies amounts, and never blocks
buys or receipt; residual risk is seller-side UX, not custody or censorship. Sell liveness is
preserved: any holder can always prepare and then transfer the entire balance. The token and
NFT sources are bound byte-exactly in the flagship closure (identical to their
Etherscan-verified inputs), and the seller-exit suite exercises this exact boundary.

## Failure behavior

Every failure is an atomic revert of the enclosing pool action. Because the hook holds no value
and gates no exits, there is nothing to pause, rescue or migrate, and no authority that could;
this permanence is a deliberate, disclosed design property of the artwork.
