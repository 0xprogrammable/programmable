# Threat model

The design is high risk because one hook changes trader amounts through return deltas and holds ERC-6909 native-currency claim backing. It is not audited or deployed.

## Assets and custody

| Asset or right | Custody and owner | Exit |
| --- | --- | --- |
| `BOX` | Holder wallet or PoolManager settlement | Transfer, sell or irreversibly open whole units |
| Membership time | Expiry stored for the opening wallet | Non-transferable and non-refundable |
| Canonical pool liquidity | PoolManager and each position owner | Defined by the selected position custody; the hook owns none |
| ERC-6909 native-currency claim backing | `DiscoveryHook`, attributed only to the immutable Programmable owner | Burn inside an authenticated unlock and take equal ETH to an owner-selected destination |
| Fee liability | `(PoolId, native ETH, owner)` ledger | Reduced only by a successful owner claim |
| Future indexed state | Integration database or browser cache | Discard and rebuild from confirmed chain state |

The visual box reveal carries no economic, access or redemption difference. No secret, proof, oracle price, keeper key or cross-chain message exists.

## Trust boundaries

- PoolManager is the authority for pool state, callbacks and transient balance deltas. The hook accepts no other callback caller.
- The one-shot registrar can bind one canonical PoolKey during launch. It has no later control.
- The router settles user deltas and enforces final slippage and deadlines. The hook does not treat router or callback `sender` as the user.
- The selected `IOpenableAsset` is the source of truth for the opened count. `DiscoveryBox` separately owns membership expiry. The hook fails closed if its fixed counter read fails.
- The hook pins the selected asset and maturity target during construction. It has no runtime module registry or mutable application address.
- Reference ticket and collectible applications cannot affect the canonical membership pool unless a separate hook and PoolKey are deployed for them.
- The immutable Programmable owner controls only claims against its own accrued liability.
- The browser, RPC, quoter and indexer are untrusted displays and transaction helpers. They cannot create membership, change fees or prove a receipt without confirmed chain state.
- Third-party discovery and routing providers make separate support decisions. No support is assumed.

## Hook permissions

The hook address must encode mask `0x10cc`.

- `afterInitialize`: bind and initialize the canonical dynamic-fee pool once.
- `beforeSwap`: authenticate the pool, read `openedBoxes`, set the directional LP-fee override and collect specified-ETH fees.
- `afterSwap`: collect unspecified-ETH fees and verify full execution on specified-ETH paths.
- `beforeSwapReturnDelta` and `afterSwapReturnDelta`: return the fee credits described in the proposal.
- The other 9 callback and return-delta flags are disabled.

Callbacks reject the wrong PoolManager or PoolId. `hookData` is unused. Swap callbacks may mint only the exact ERC-6909 claim needed for fee backing. A claim-specific unlock may burn that claim and take equal underlying ETH. The hook cannot call a same-pool swap, modify liquidity or donate. A revert unwinds the full unlock.

## Accounting boundary

A positive hook delta is a hook credit and caller debit. The hook first mints `F` ERC-6909 native-currency claims to itself, which creates an equal transient hook debt without requiring PoolManager to transfer ETH before router settlement. It then records liability and returns `+F`. PoolManager applies the returned credit in the same unlock.

Redemption starts a separate PoolManager unlock. The hook burns the requested claim, creating `+amount`, then takes equal native ETH to the destination, creating `-amount`. The callback returns with zero delta.

Required invariants are:

```text
final caller delta = core swap delta - hook delta
hook transient PoolManager delta = 0 at unlock end
fee liability increase = ERC-6909 native-currency claim minted = positive hook delta
hook ERC-6909 native-claim balance >= aggregate liability
```

The fee is always native ETH and 10 basis points of executed gross quote-side volume. The platform remainder is the residual numerator on a 1,000,000-unit fee scale for the canonical pool lifetime; an owner claim does not reset it. Gross paths divide by 1,000,000 and fee-on-top paths solve the same cumulative-gross identity with denominator 999,000. Thus `accrued fee * 1,000,000 + remainder = cumulative gross volume * 1000` across mixed quadrants before claims, while lifetime fees earned remain independent of claim timing. The project rate is exactly zero, so its independent stream is inert.

Zero execution is fee-free. Every positive executed gross native amount below 1,000 units is rejected before minting a claim or writing liability or remainder. This fail-closed minimum prevents fragmentation from turning sub-fee-unit swaps into a carry-dependent execution policy.

Specified-ETH paths reject partial fills after the core swap because a before-swap charge cannot use an unexecuted requested amount. Unspecified-ETH paths use the actual core delta. This difference must be visible in quotes and tests.

Claims follow checks, effects and the claim-specific unlock under a reentrancy guard. A failed destination reverts the burn, take and liability decrement. An excess ERC-6909 balance creates surplus only. It does not create a liability or rescue right.

## Main attack and failure scenarios

| Threat | Control and required evidence |
| --- | --- |
| Forged callback | Authenticate exact PoolManager and canonical PoolId in every callback; direct-call tests |
| Wrong or duplicate initialization | One-shot registration and initialization; wrong-key and repeat tests |
| Partial or misbound launch | The bound BOX factory, HookMiner factory and launch factory atomically deploy, register, initialize and lock liquidity; invalid salt and callback tests prove rollback |
| Launch front-running or child predeployment | Derive the BOX salt from caller plus seed, restrict both child factories to the declared launch registrar and prove copied calldata cannot occupy the intended addresses or take the LP-fee entitlement |
| Initial-position principal withdrawal | The launch factory exposes only a zero-liquidity-delta fee collection for the immutable per-pool launch recipient; tests prove the position liquidity is unchanged |
| LP-fee redirection | Only the stored launch recipient can collect accrued fees, may choose the destination per call and cannot mutate the recipient |
| Permission-address mismatch | DiscoveryHookFactory recomputes the CREATE2 address and asserts all 14 flags and `0x10cc` before deployment |
| Counter manipulation | Only whole irreversible burns increase `openedBoxes`; fuzz supply/count invariant |
| Malformed token read | Require exact ABI return and bounds; revert the swap |
| Direction confusion | Bind ETH as currency0 and `BOX` as currency1 in the canonical key; test both directions |
| Gross-versus-net fee error | Differential tests for all 4 quadrants, dust and gross-up identities |
| Partial-fill overcharge | Revert partial specified-ETH fills; charge actual unspecified-ETH results |
| Subminimum execution, zero AMM leg or sign crossing | All four quadrants reject positive gross quote below 1,000 with the exact wrapped hook error before accounting; zero execution remains fee-free and every successful positive swap has a positive core leg |
| Transient delta left open | Ordered mint and returned-delta tests for accrual; ordered burn and take tests for redemption; zero-delta invariants |
| First buy has no settled ETH yet | Mint ERC-6909 backing during callback instead of taking ETH before router settlement |
| Reentrancy during claim | Non-reentrant claim, authenticated unlock callback and atomic burn/take path |
| Insolvent or cross-pool claim | Exact liability key, no netting, balance invariant and excessive-claim reverts |
| Builder or project theft | No project fee, rescue, sweep, owner mutation or arbitrary withdrawal path |
| LP-fee bypass claim | LP fees remain separate and cannot satisfy the hook-owned Programmable liability |
| Alternative pool bypass | Policy is claimed only for the registered PoolKey; alternatives receive no implied behaviour |
| Router quote drift | Stateful quote at one confirmed block and final-delta enforcement |
| Stale or forged app state | Confirmed direct reads, 12-block finality, reconciliation and unavailable state |
| Reorg or omitted log | Block-hash checkpoints, deterministic rollback and full backfill |
| Membership overstatement | Public copy says entitlement activation, not app use or unique users |
| Partner service failure | Onchain expiry remains truthful, but service delivery is an external commercial obligation |

## Dynamic-fee risk

Buys always use 0.30%. Sells use:

```text
10000 - floor(min(openedBoxes, 40) * 7000 / 40)
```

in hundredths of a basis point. The result is bounded from 3,000 to 10,000. It changes automatically on each swap but has no mutable parameter or keeper.

The economic model shows that this spread adds almost no opening demand. The public claim is limited to a market-maturity signal. It must not be presented as a dominant incentive, guarantee of adoption or protection against price loss.

## Authorities and recovery

The registrar acts once and cannot block later user exits. The Programmable owner can claim only its own liability. There is no admin, pause, upgrade, migration or retirement path.

If a fault is found, the team cannot patch the contracts. The operational response is to disable demo quote and trade controls, publish the affected PoolId and block, preserve read-only opening and claim information where correct, and prepare a separately reviewed deployment. This is a limitation, not an emergency control.

## Known limitations

- The prototype has no production app commitment, refund, membership transfer or Sybil resistance.
- A burn proves entitlement activation for a wallet, not product use by a unique person.
- Specified-ETH partial fills are deliberately unsupported.
- Multihop routing remains unsupported until final-delta and parity tests cover it.
- Exact launcher, tick range, initial price and deployment records remain release inputs.
- Local tests cannot prove audit, live fee collection, source verification, routing support or availability.
- Independent accounting, security, architecture and maintainer reviews remain required.
