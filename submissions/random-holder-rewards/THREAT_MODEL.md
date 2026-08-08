# Threat model

Random Holder Rewards

## Protected properties

- Only the immutable PoolManager enters swap callbacks, and only the exact canonical PoolKey is accepted.
- Every successful canonical swap accrues 10 bps of executed gross ETH quote volume to the immutable Programmable owner.
- Buy and sell totals are immutable per launch and remain inside 0.1–3% and buy-rate–5% bounds; exactly 10 bps goes to Programmable and only the remainder reaches the reward pot.
- Returned deltas are matched by ETH taken in the same callback and all PoolManager deltas finish at zero.
- Platform, pot, and winner liabilities never exceed raw ETH backing and are never netted across pools.
- Only the immutable VRF coordinator fulfills the one pending request; request data binds the snapshot block and holder-index prefix before randomness exists.
- Only the platform owner or the entitlement-owning winner initiates its own claim.
- Existing claims and LP exits do not depend on VRF liveness.

## Threats and controls

### Fee bypass or wrong quadrant

Routers, alternative pools, donations, token transfers, and LP fees cannot substitute for the mandatory hook fee. Tests cover both directions and exactness modes, partial execution, rounding, tiny amounts, gross-up, wrong PoolKeys, and same-pool self-call absence.

### Callback or settlement forgery

Direct calls from any address except PoolManager revert. Every callback validates the immutable PoolKey, accepts no hookData identity, and returns the exact selector and shape. ETH is taken before the matching positive return delta is accounted; revert atomicity prevents an unbacked liability.

### Liability theft or reentrancy

There is no mutable recipient, rescue, sweep, arbitrary call, proxy, or upgrade. Claims use caller-owned liability, checks-effects-interactions, and reentrancy protection. Reverting and reentrant recipients cannot consume or redirect another entitlement.

### Randomness manipulation

`block.timestamp`, `blockhash`, and `block.prevrandao` never select winners. The request fixes the snapshot before the coordinator response. Only the exact pending request id from the immutable coordinator is accepted. A failed or duplicate response cannot allocate the pot twice.

### Timing manipulation and liveness

Timestamp controls only earliest request eligibility; modest proposer skew cannot choose randomness. Requests are bounded to one pending id and one per 1,800 seconds. Anyone may expire a request that remains pending for two hours; the expired request's later callback is rejected and its pot remains available for retry. An unfunded or unavailable coordinator delays rounds but cannot affect swaps or existing claims. Monitoring alerts on stale requests and subscription runway.

### Holder-index denial of service

The holder list is append-only, so an attacker can create many former-holder entries. A nonzero 0.1%-supply eligibility floor makes qualifying many addresses expensive but does not stop index growth. Fulfillment performs at most `32 + 4 × configured winners` candidates; if enough winners are not found, the pot remains intact and the failed round is observable. This is a known liveness limitation, not silently replaced with trusted selection.

### Sybil capture

Selection is per eligible address. One actor may split enough tokens among several addresses and receive several independent chances. The protocol makes no person-level fairness claim. The configured winners are unique addresses, not necessarily unique people. The UI must display this limitation beside the winner-count control.

### Creator extraction and adverse selection

Creators could select taxes that look attractive to holders but make entry or exit uneconomic for traders. Constructor bounds prevent confiscatory values, the sell rate cannot be lower than the buy rate for this stated model, and the UI shows trader retention and the tax wedge before configuration export. Bounds do not prove market equilibrium: traders may rationally avoid any configuration, and a high sell rate may reduce price, liquidity, volume, and rewards.

### UI/configuration mismatch

The UI is not an authority. Its exported integer rates and winner count must match constructor units and bounds exactly. Contract validation remains authoritative and rejects stale, manipulated, out-of-range, or sell-below-buy inputs. The prototype UI creates no wallet request or transaction and must not imply deployment.

### Forced ETH and accounting drift

Raw balance is not entitlement. Only callback accrual and successful round allocation create liabilities. Forced ETH remains surplus. Invariants reconcile events, getters, and balance after swaps, rounds, claims, failed recipients, and forced transfers.

### Dependency drift

PoolManager and VRF coordinator addresses are immutable, but their observed runtime and operational state must be monitored. No alternate coordinator or PoolManager can be installed. Deployment remains blocked until exact runtime, interface, source, and chain evidence is recorded.

## Review requirements

Return-delta accounting, custom fee bases, custody, randomness, autonomous requests, and bounded holder selection require independent economic and security review. Repository tests are not an audit and cannot establish deployment, routing, or availability.
