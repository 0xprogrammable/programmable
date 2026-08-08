# Test plan

Random Holder Rewards

## Build and structure

- Pin Solidity 0.8.26, Cancun, optimizer settings, v4-core, v4-periphery, OpenZeppelin Contracts, and forge-std.
- Compile complete import closure with no unexplained warning; record runtime and initcode sizes.
- Reproduce hook permission mask `0x00cc`, CREATE2 salt, initcode hash, expected hook address, immutable buy/sell/winner configuration, and runtime hash.
- Test only-PoolManager callbacks, wrong PoolManager, wrong PoolKey, selector and return lengths, empty hookData policy, and self-swap absence.

## Fee unit and lifecycle cases

- Prove mandatory selected totals 0, below 10 bps, at 10 bps, and above 10 bps, including `3% = 0.1% + 2.9%` in the shared fee math helper.
- Test buy and sell, exact input and exact output, with zero, one, rounding boundaries, maximum int128-safe amounts, and overflow-adjacent values.
- Prove buy-rate boundaries 0.1% and 3%, sell-rate boundaries buy-rate and 5%, sell-below-buy rejection, defaults 1%/2%, upward rounding, gross-up, nonzero residual AMM leg, and the numerical examples in `PROPOSAL.md`.
- Use executed quote on after-swap paths; prove before-swap paths either fill the fee-adjusted amount exactly or revert, then reconcile `HookFeeAccrued` with PoolManager final deltas, raw ETH, and liabilities.
- Prove alternative PoolKeys, LP fees, token transfers, donations, and router choice cannot satisfy or bypass canonical fee accounting.
- Exercise create token, initialize pool, add liquidity, four swaps, platform claim, threshold accrual, round request, fulfillment, configurable winner claims, liquidity removal, VRF failure, and retry.

## Holder and randomness cases

- Test first-time holder indexing, no duplicate index, same-block checkpoint replacement, historical lookup, transfers before and after snapshot, and excluded addresses.
- Test winner-count boundaries 3 and 15, fewer eligible holders than configured winners, derived attempt budgets, one pending request, two-hour permissionless expiry, stale callbacks, duplicate/unknown callbacks, wrong coordinator, zero random word, duplicate candidates, attempt exhaustion, and successful unique allocation.
- Prove holder-count prefix and snapshot block cannot change after request.
- Test sparse eligibility and Sybil-style address splitting as disclosed behavior, not person-level resistance.
- Test VRF request revert, delayed callback, failed round, and retry without pot loss.

## Claims and custody

- Test platform owner claim to self and per-claim destination; reject builder, arbitrary caller, winner, rescue, sweep, recipient mutation, and owner mutation attempts.
- Test each winner claiming only its own entitlement, partial claim, full claim, repeated claim, zero destination, rejecting recipient, and reentrant recipient.
- Force ETH into the hook and prove it creates no liability.
- Assert after every operation: `balance >= platformLiability + rewardPot + totalWinnerLiability`.
- Assert allocation conserves `potBefore = allocated + remainder` and claims conserve `balanceBefore = paid + balanceAfter`.

## Fuzz and invariants

- Fuzz fee amounts, swap modes, timestamps, holders, transfers, random words, claim destinations, and callback actors.
- Stateful handlers mix accrual, round requests, fulfillment, failed fulfillment, transfers, platform claims, winner claims, and forced ETH.
- Track useful calls and expected reverts so reject-heavy runs cannot appear as coverage.
- Invariants cover solvency, conservation, immutable configuration, one-pool isolation, claim authorization, maximum rates, unique winners, one allocation per request, and available LP exits.

## Dependencies and operations

- The pinned Ethereum fork suite passed 3/3 tests at block 25,702,654 and the current-head smoke passed 3/3 tests at observed block 25,706,498. Both bind the deployed PoolManager and VRF coordinator runtime hashes, accept the request ABI, and finish buy/sell exact-input/exact-output swaps with zero PoolManager settlement deltas.
- The pinned CREATE2 record publishes deployer `0x7fa9385be102ac3eac297483dd6233d62b3e1496`, salt `0x0000000000000000000000000000000000000000000000000000000000007b3e`, the complete ABI-encoded constructor arguments, initcode hash `0xbb1d38ad644d7ead2595d322f7ada9111abb15373f83522f297cb5025ac5d998`, runtime hash `0xc60a9528b58dc5cf3b909dc6805dcaf1a9469e71506406e3a2de0231fb42c6ee`, expected hook `0xc5c2f63f6bb3a15252d870a4e24f83fcd346c0cc`, and permission mask `0x00cc` in immutable `fork-evidence.json`.
- The Sepolia rehearsal passed 4/4 pinned tests at block 11,353,915 and 3/3 current-head tests at observed block 11,441,586 against the deployed PoolManager, VRF v2.5 coordinator, LINK token, and key hash. A fork-only funded subscription authorizes the exact consumer, accepts a real coordinator request ABI, completes the reward callback lifecycle for ten winners, and completes a pull claim.
- Mainnet and Sepolia subscriptions in these tests exist only inside local forks. They do not claim a public deployment, public funding, or live DON fulfillment. The review-only launch remains fail-closed at subscription id zero until an authorized platform deployer supplies and verifies its production subscription.
- Unit and invariant coverage also exercises unavailable, reverting, duplicate, stale, and unauthorized VRF responses.
- Gas bounds: beforeSwap, afterSwap, requestRound, the maximum 92-attempt fulfillment, platform claim, and winner claim.
- Run Slither and record every finding disposition. If unavailable, report the gate blocked rather than passed.

## Product and release boundaries

A static launch-configuration UI is included without wallet or deployment capability. Test field boundaries, decimal-to-hundredths-of-bip conversion, sell-at-least-buy validation, winner bounds, defaults, payoff/variance copy, Sybil disclosure, exported schema, keyboard behavior, responsive layout, and the absence of wallet or transaction calls. Later product tests must prove quote/execution parity, final-delta validation, stale/reorg recovery, claim preview parity, monitoring alerts, and unsupported routing. Maintainer acceptance, deployment, verification, routing, and availability remain separate uncompleted gates.
