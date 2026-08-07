# Proposal

OpenHours launches one directly tradable OPEN/USDC Uniswap v4 pool and a separate, fully pre-funded epoch redemption vault. The AMM remains live independently of NAV production.

## Executable launch

`spec/openhours.json` is the data-only launch authority. It targets Ethereum Mainnet and the current `programmable:production` generic CREATE2 adapter. The adapter executes one outer transaction:

1. Mine the hook target salt for exactly `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta` (`0x20cc`).
2. Deploy the one-shot registration factory and initialize it with the deterministic launcher address.
3. Deploy the mined hook with exact PoolManager, factory registrar, and USDC constructor bindings.
4. Deploy `OpenHoursAtomicLauncher`, which creates OPEN and the vault, registers the full PoolKey, initializes the pool, pulls funding, mints locked full-range liquidity, clears approvals, refunds unused budgets, and asserts the end state.

Every effect above shares the adapter's outer transaction. Any failure reverts the factory initializer, hook and launcher deployments, launcher-created children, registration, initialization, transfers, approvals, and liquidity mint. A failed launch does not consume the wallet's pre-existing exact USDC allowance; the wallet must retry the same deterministic target or revoke it.

## Frozen launch economics

| Item | Executable value |
| --- | --- |
| Launched token | `OpenHours` / `OPEN`, 18 decimals |
| Supply | Fixed 1,000,000,000 OPEN; minted once to the launcher; no mint or admin authority |
| Quote | Ethereum Mainnet USDC at `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Funding actor | Launch-session wallet |
| Maximum budgets | 900,000,000 OPEN and 100,000 USDC |
| Pool | Address-sorted OPEN/USDC, dynamic fee flag, tick spacing 60, exact mined hook |
| Initial tick | `-367020` when OPEN is currency0, otherwise `367020` |
| Range | Full usable range `[-887220, 887220]` |
| Liquidity amount | Maximum liquidity supported by both budgets at the initialized price; rounded token debts up |
| Custody | PositionManager NFT minted directly to `0x000000000000000000000000000000000000dEaD` |
| Remainders | All unused OPEN and USDC returned to the launch-session wallet |

The wallet must hold at least 100,000 USDC and approve exactly 100,000 USDC base units to the compiler-predicted launcher before the launch transaction. The launch wallet is also the immutable project fee owner, vault issuer, vault NAV signer, and token-remainder recipient. This is the only launch-session address input.

## Direct trade path

`OpenHoursTradePlanner` encodes both directions and both exact-input-single and exact-output-single swaps for the complete launched PoolKey. It targets the production-bound Universal Router 2.1.1 and uses command `0x10` (`V4_SWAP`), V4Planner action `0x06` or `0x08`, then `SETTLE_ALL` (`0x0c`) and `TAKE_ALL` (`0x0f`). The extended swap struct fixes `minHopPriceX36` to zero and hook data to empty bytes.

ERC-20 input uses the exact Permit2 path: token approval to the pinned Permit2 contract and a bounded, expiring Permit2 allowance to the pinned Universal Router. Callers supply amount bounds, recipients, and deadlines. Expired, under-delivering, over-spending, unapproved, or otherwise failed swaps revert.

The executable encoder is a contract library and evidence surface, not a hosted wallet UI or route-discovery service. A production client must obtain a V4Quoter result, apply an explicit slippage policy, verify current dependency runtimes, and submit the returned router calldata.

## Hook and vault behavior

The hook's one-shot registration validates the complete PoolKey and vault binding, stores canonical state, self-initializes the pool, and writes the 3,000-pip stored fallback. Canonical swaps use bounded before-swap overrides: buys use 3,000 pips; sells use `3000 + floor(17000*u^2)` while a funded redemption lane is open and 20,000 otherwise.

Exactly 10 bps of successful canonical-pool gross quote volume belongs to the immutable Programmable fee owner. The effective fee includes that share; it is not added on top. PoolManager ERC-6909 quote claims back the recorded liabilities.

The separate vault accepts exact OPEN queue deposits against a pre-funded USDC reserve. A finalized epoch pays `floor(receiptOpen * finalNav / 1e18)`. If no valid report arrives, expiry permits exact OPEN recovery. The vault is deployed with no open epoch, so NAV unavailability cannot block launch or pool swaps.

## NAV production boundary

`docs/NAV_PRODUCER_BOUNDARY.md` specifies the authenticated producer, issuer ledger input, HSM/KMS signing boundary, five-minute observation freshness, fifteen-minute signing horizon, fail-closed behavior, relay allowlist, audit record, and incident handling. No private key, credential, RPC secret, or production endpoint is stored in this repository.

The immutable launch wallet is the prototype signer identity. Before a real-value launch it must be an EIP-1271 wallet controlled by the documented HSM/KMS policy; an ordinary browser EOA is not an acceptable production signer. A producer outage prevents new epoch finalization and leads to the existing onchain expiry/recovery path; it never affects AMM trading.

## Dependency authority and status

Every external dependency is bound by chain, exact address, runtime hash, source/runtime identity, and role in `spec/openhours.json`. These bindings come from canonical `programmable:production` commit `c7346ab41046e5a600acc88acb37b73d3bbb80b9`, including its Ethereum Mainnet dependency snapshot and stock-paired-v3 release.

This remains an applicant revision requiring maintainer review. It claims no audit, deployment, runtime observation of the new targets, legal backing, hosted client availability, or production NAV operations.
