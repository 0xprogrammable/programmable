# Module Mode native runtime candidate

Status: local source candidate, 5 September 2026. This runtime is not a tradable engine, an admission decision, an audit, a deployed contract or a live Module Mode release. The test engine is deliberately a harness; its inputs do not prove actual swaps, fees, user routing or Programmable provenance. A separate native V4 engine must supply that proof before availability.

## Implemented boundary

`ModuleNativeRuntimeV1` binds one immutable engine address and its deployed code hash. Only that engine can register launches or supply completed trades. A module runs ordinary Solidity in its own separate contract. The runtime contains no module business-name enum, delegatecall, configurable arbitrary-call capability, LP access, token minting, Creator-fee diversion, fee setter, pause, upgrade or instance replacement path.

Registration fixes the source, launch wallet, token, PoolManager, primary pool ID, recipe hash and complete program hash. `programHash` commits the ordered selections: package ID, factory/address/hash, resulting program runtime hash, callback gas and exact config bytes. The engine must incorporate this hash into its full fee/market recipe. The runtime does not equate a package ID with an admitted author family.

`launchKeyFor` includes chain, runtime, engine and the complete binding. This is a program binding key, distinct from a canonical launch ID that may only become known after initial settlement. A source/token or PoolManager/pool cannot be rebound to another recipe in this runtime. Each selection gets a separate instance ID and contract, even when several selections use the same package. The factory must return an unused contract with the exact selected code hash and constructor binding hash. Selected config bytes are emitted; there are no post-registration config setters.

Runtime-code checks bind direct bytes. They do not establish immutable effective logic behind a proxy, beacon, forwarding dependency or external administrator. Actual admission must review the exact factory and resulting program/dependency behavior. The provided program factories deploy direct constructor-configured contracts without those paths. Constructor-only configuration storage intentionally keeps their compiled runtime hashes identical across differently configured instances.

## Lifecycle and authentication

- Construction initializes each selected instance from its exact config.
- `executeTrade(launchKey, Trade)` applies completed-trade callbacks in the bound order. `sequence` starts at one and advances without gaps; a successful sequence cannot be replayed. The execution ID binds all supplied facts. `initialBuy` is only accepted on a buy at sequence one.
- `Trade` contains actor, payer, recipient, actual gross native amount, actual token amount, direction, exactness and initial-buy status. The immutable engine must derive these from its real atomic execution. Matching nonzero addresses or amounts are not proof of a fill. Neither `tx.origin`, the V4 router address nor unauthenticated `hookData` is substituted for an actor.
- `executeAction(launchKey, index, actionId, inputs, expectedNonce, deadline)` authenticates its direct caller as actor and binds a per-actor/per-launch nonce and deadline. The program must enforce its own declared role policy; metadata or a visible button grants no right. Reverted actions retain their nonce. Inputs grant no arbitrary runtime authority.
- All lifecycle calls remain guarded during callbacks, including attempted nested calls through the engine and across launches. A program must acknowledge the exact callback selector in exactly one ABI word. Reverts, gas exhaustion, oversized returns, wrong acknowledgements or a later program veto revert all earlier program state, credits and caller-side work in that transaction.

The runtime provides a completed-trade callback, not separate V4 before/after callbacks or universal liquidity/message triggers. Post-trade validation can veto an atomic swap. Additional lifecycle interfaces require a separate reviewed runtime/engine revision for new launches.

## Prefunded capital and claims

`ModuleNativeBudgetVaultV1.fund(instanceId)` accepts an irrevocable native contribution to that instance. It is a separate amount from the launch's mandatory initial buy. It charges no additional tax and consumes no Creator, author, treasury or LP balance. A deployment flow must disclose the amount and irrevocable funding purpose before a wallet signs.

During a callback the current program may call `runtime.credit(beneficiary, amount)`. The runtime supplies the instance ID itself, enforces at most eight credits per callback and calls its own immutable vault. The program cannot choose another instance's bucket, spend an existing claim, self-grant another capability or call the vault's protected credit operation directly. A program can spend its own whole available budget under its reviewed rules; the core does not certify who economically deserves that capital.

Credits move actual backing from available budget to a beneficiary's claim. No recipient is called during a trade/action. Anyone may pay an existing beneficiary through `claim(instanceId, beneficiary)`; only that beneficiary may redirect its own claim with `claimTo`. Claims use checks/effects/interactions and OpenZeppelin transient reentrancy protection. A reverting recipient keeps its claim and can redirect it; it does not block later trades. There is no admin sweep or revocation of credited claims. Forced transfers do not become available budget.

For all successful operations:

```text
totalFunded - totalClaimed = totalAvailable + totalOutstandingClaims
vault native balance >= totalAvailable + totalOutstandingClaims
```

CTO destination changes and author-family royalties remain the fee engine/ledger's separate responsibility. This runtime does not make a rotatable Creator destination responsible for promised module funding. Recurring funding from Creator tax would require an explicit immutable allocation before the rotatable personal payout, separately reviewed and tested.

## Two ordinary example programs

`EveryNthBuyRewardV1` counts buys with at least the configured gross native amount before its fixed end time. Each Nth qualifying buy earns a fixed native claim for the engine-authenticated actor if this instance already has enough budget. Payer and token recipient can differ; neither silently replaces the actor. Initial-buy inclusion is explicit config. An empty budget skips that milestone permanently, without debt or a later retroactive claim. The program does not call a recipient during trading.

Its configuration is exactly 192 bytes: ABI encoding of `(uint32 everyN, uint128 minimumGrossNative, uint128 rewardNative, uint64 endsAt, bool includeInitialBuy, address refundWallet)`. `refundWallet` must be nonzero and is fixed during construction. This unpublished candidate revision rejects the earlier 160-byte input; no deployed compatibility is claimed. Predictable ordering creates strategic/MEV incentives and a wallet is not a unique human. This is an experimental reference mechanism, not an economic-safety or anti-wash-trading claim.

The fixed action `RECLAIM_UNUSED = keccak256("programmable.module-mode.reward.reclaim-unused.v1")` accepts empty inputs only. At or after `endsAt`, only the runtime-authenticated refund wallet may execute it. It credits that wallet with this instance's remaining **available** budget and leaves existing winner claims unchanged. The wallet then uses the normal pull-claim route. Zero available budget is a successful no-op; every successful action still consumes its current nonce. Fresh funds sent after expiry are likewise reclaimable by the same fixed wallet. There is no platform/admin sweep and no right to withdraw another instance's funds. The UI must show the fixed refund wallet before funding, expose this action after expiry and preserve the winner/refund claim views.

`TimedWalletBuyCapV1` sums each authenticated actor's actual gross native buys during its immutable opening window and vetoes a trade that exceeds the configured cap. Fragmenting purchases from the same wallet does not bypass the aggregate. Other wallets remain separate; sells are untouched and the cap ends at the fixed timestamp. This is not a claim of guaranteed anti-sniping or anti-Sybil protection.

Its configuration is ABI encoding of `(uint128 capNative, uint64 duration, bool includeInitialBuy)`. The duration is one second through 30 days and begins at instance creation. Neither example permits changing its configuration. The cap has no management action; the reward has the fixed terminal reclaim action above. Essential reads, funding, claims and that terminal action must be reflected in contributor descriptors and UI before selection is enabled.

## Resource and verification scope

This candidate permits at most 16 instances, 16 KiB config per instance, 32 KiB total config, 16 KiB action input, 25,000–500,000 callback gas per instance and 2,000,000 total declared callback gas. Factory calls have a fixed 2,000,000 gas ceiling and returned data copies are bounded. These are this runtime's bounds, not catalogue limits or a promise about chain block limits. Full launch/deployment and claim costs still need measurement with the real engine. Existing fee-ledger family bounds can impose a lower selection limit.

The repository's pinned Solidity 0.8.26, Cancun EVM, optimizer runs 1,000 and source dependencies are retained. EIP-1153 availability remains a chain-release requirement. Reproduce the focused checks from the repository root:

```bash
(cd contracts && ./scripts/bootstrap-deps.sh)
contracts/test/module-mode/run-tests.sh -vv
(cd contracts && forge fmt --check src/module-mode test/module-mode)
```

The runner isolates source/test/artifact directories and disables dependency auto-remapping; checked-in `contracts/remappings.txt` remains authoritative. An upstream CCA `test/=` alias otherwise redirects local test fixture imports. It does not change compiler, EVM, optimizer, fuzz count or dependency pins.

Local verification passed 34 tests, including two 1,000-case conservation fuzz tests. Coverage includes per-launch configuration binding, invalid code/factory/binding rejection, caller authentication, per-launch sequence replay/gaps, action nonces/deadlines, same- and cross-launch reentrancy, callback failure/return-data/gas attacks, credit-budget limits, cross-instance backing isolation, pull claims, reverting/reentrant recipients, forced transfers, reward depletion, timed cumulative caps, rollback across composed programs and refund actor/time/nonce/claim isolation. The compiled runtime sizes are 10,787 bytes for the runtime, 2,719 for the vault, 2,764/7,311 for the reward/program factory and 1,669/5,043 for the cap/program factory; these are local artifact sizes, not chain deployment evidence.

Source lint completes with advisories for constructor-only storage, low-level bounded calls, timestamps and guarded post-call events. Its high-severity `arbitrary-send-eth` heuristic flags the vault's final payout: the destination is deliberately recipient-controlled, but `_claim` is private, the permissionless entrypoint fixes it to the existing beneficiary and only that beneficiary can redirect its own credit. Recipient-binding and reentrancy tests cover this boundary. This documented analysis is not an independent audit or a blanket suppression of findings. A selfdestruct compiler warning belongs only to the forced-transfer attack fixture.

## Required actual-engine binding

The safest additive lane is a new version of the existing complete `ClassicModuleLaunchV1` / native hook / position-planner / fee-ledger path. Preserve the old V1 files and its existing launches. The new hook can create exactly one hardcoded runtime after its own deployment, with no choice of target or replacement setter. A generic admission registry must bind approved factory and resulting module code, package/config envelope and author family; the current V1 registry's two effect kinds do not admit these programs.

The real path must prove all of the following before it is called usable:

1. The same fixed supply, LP custody, mandatory initial buy, expiry/minimum output and canonical source reader/event commitments as the admitted new launch profile.
2. Exactly-once runtime registration and explicit prefunding before the first callback. `msg.value` must separate initial-buy amount from the disclosed funding vector, with no accidental use of forced launcher funds.
3. An immutable authenticated route derives actor/payer/recipient; unsupported identity-dependent routes fail honestly. The initial buy derives identity from the bound actual launch caller. The hook verifies PoolManager and remains guarded throughout the complete before/after lifecycle.
4. Fixed 20 bps plus the selected 0–10% whole-step Creator fees, in native ETH for this profile, with old-claim-preserving CTO semantics and equal deduplicated author families. No module callback can bypass their accounting.
5. Real PoolManager tests for buy/sell × exact input/output, actual gross/fee/token amounts, partial-fill policy, fee rounding, price/output limits, funded rewards and module veto rollback. These runtime harness tests are not those tests.
6. Exact reviewed deployment/source bindings, finality-backed collection, launch-to-profile/Explore round trip, claims, generated module management and public contribution/availability gates. A copied origin reader or matching metadata is not release authority.

Different quote assets and new execution primitives remain possible through separately bound engines/runtime revisions. This candidate's native budgets do not convert stock/other-asset fees to ETH automatically and do not freeze future package capabilities to these two examples.
