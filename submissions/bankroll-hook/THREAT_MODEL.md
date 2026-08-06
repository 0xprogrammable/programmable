# Threat model

## Scope

This threat model covers the local launcher, permanent position locker, hook, factory, router, bankroll ledger and randomness adapter.

## Assets

- WETH bankroll assets owned pro rata by internal shares
- WETH open stakes and player claim liabilities
- reserved bankroll exposure for unsettled tickets
- native PoolManager ERC-6909 claims backing the Programmable fee
- the canonical PoolId, ticket outcomes and season seed
- direct-funded native ETH sent to the Chainlink wrapper
- the permanent v4 position NFT and launch-token dust held by its locker

Bankroll shares and tickets cannot transfer. The hook has no rescue function. Accidental direct token transfers do not create a claim.

## Authorities and trust boundaries

PoolManager is the only accepted hook callback and unlock-callback caller. The hook also derives and checks one exact PoolId on every callback.

The immutable registrar is the only accepted pool initializer. The factory must bind the immutable router first.

The launcher trusts its immutable UERC20 factory and Uniswap PositionManager. It checks the fixed supply path and the hook's complete configuration before it initializes the pool. The initial creator buy has a caller-bound minimum output. The position locker accepts NFTs only from its immutable PositionManager and exposes no transfer, decrease, rescue or arbitrary-call path.

The router is the only accepted source of non-empty hook data. Hook data carries a pending identifier, not a user identity. The immutable router records the player and stake before the swap. The pending record must exist in the same block and the swap must be exact input. The router cannot change hook economics or settle tickets.

The immutable Chainlink adapter is the only randomness source. Its wrapper base authenticates fulfilment. The adapter lets only the hook consume a stored word.

The fixed Programmable owner is the only fee claimant. It may choose a destination for one claim. There is no mutable recipient or builder claim path.

## Hook permissions

The expected address mask is `0x30cc`.

| Permission | Enabled | Reason |
| --- | --- | --- |
| beforeInitialize | yes | Authenticate the registrar, PoolKey and router binding |
| afterInitialize | yes | Record the PoolId and open Funding |
| beforeSwap | yes | Validate wager data and charge specified-quote fees |
| afterSwap | yes | Charge unspecified-quote fees and create tickets from execution |
| beforeSwapReturnDelta | yes | Remove or gross up the specified native quote fee |
| afterSwapReturnDelta | yes | Collect the unspecified native quote fee |
| all liquidity and donate callbacks | no | No custom behaviour needs them |

BaseHook authenticates PoolManager. Every enabled callback returns the required selector. A callback revert rolls back the complete PoolManager action.

## Accounting invariants

The WETH balance must be at least bankroll assets plus open stake liability plus player claim liability.

Reserved exposure must not exceed bankroll assets or 80% of bankroll assets.

A staged stake becomes a ticket only after a successful swap. Reverting the swap also reverts WETH movement and the staged record.

A win decreases bankroll assets by exposure and increases player liability by gross payout. A loss moves the stake from open liability into bankroll assets. A timeout moves open stake liability into player liability without changing bankroll assets.

The native Programmable liability must equal its backing PoolManager claim until claim. Claim clears the whole-unit liability, burns the claim and transfers native ETH in one atomic unlock. A separate numerator remainder is carried by canonical PoolId, native currency and immutable owner and is not cleared by claims, so split micro-swaps cannot discard fee dust or net it across pools.

## Main attacks and controls

Malformed or replayed hook data fails version, length, sender, pending-id, block and state checks.

An attacker cannot use exact output for wager mode. Ordinary exact-output swaps remain available with empty hook data.

A trader cannot stake against requested volume. The hook applies the 20% cap to actual executed gross native quote. Unsupported wager partial fills revert.

Ticket count and settlement batch size bound storage growth and per-call work. Randomness fulfilment does not loop or transfer value.

A liquidity provider cannot withdraw during Active or before player liabilities are separated. Final redemption uses the remaining bankroll and gives the last redeemer rounding dust.

The creator cannot recover the launch position or token dust. Anyone may collect position fees, but the locker always sends them to the immutable creator recipient.

The builder cannot pause, upgrade, change odds, replace the router, replace the randomness adapter, rescue balances or redirect fees.

The factory accepts caller-supplied init code so CREATE2 salts remain caller-selectable, but it binds the reviewed implementation. It checks the exact hook creation-code length and hash, the constructor-argument suffix, the CREATE2 mask, the deployed hook bindings and the immutable-slot-normalised runtime hash. The router factory constructs and checks the reviewed router init code and runtime. Both factories publish raw and approved hashes in provenance mappings. The launcher snapshots those approved hashes, checks the returned provenance and includes all values in the launch hash and launch event.

## Dependency failures

A PoolManager or token-transfer failure reverts the complete call. There is no fallback manager.

An unfulfilled VRF request can expire after the immutable timeout. A fulfilled request cannot expire and must use permissionless consumption. A malicious or broken fulfilled adapter could still stop progress. The selected Ethereum wrapper runtime and interface are pinned at block 25,690,000, but production launch must re-check its current runtime, quote and funding.

The request, consume and expiry entry points share one transient reentrancy guard. An adapter cannot expire and then reopen the game during a request or consumption callback; the adversarial lifecycle test exercises both attempted callbacks.

The selected Ethereum dependency runtimes and full launch lifecycle are verified on a pinned historical fork. The aggregate official launcher profile remains runtime-unverified, and the official PoolManager and PositionManager records do not yet resolve to immutable source commits. No production launch should treat the fork as current monitoring or reproducible source verification.

## Missing evidence

- no immutable source-commit resolution for the official PoolManager and PositionManager deployment records
- no independent audit
- no accepted routing, client, API or indexer integration
