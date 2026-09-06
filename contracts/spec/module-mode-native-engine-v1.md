# Native Module Mode engine V1

This is additive candidate source. No deployment, source verification, public admission or production availability is asserted by this document. Existing Classic launch contracts and their records are unchanged.

## Market and identity

`ModuleNativeLaunchV1` launches a fixed 1,000,000,000-token, 18-decimal UERC20 with the pinned UERC20Factory. It reuses `ClassicModulePositionPlannerV1`, `ClassicModuleLaunchPolicyV1` and `LockedPositionFeeForwarderFactoryV1`. All initial supply goes to one finite-range, one-sided native ETH/token Uniswap V4 position, including permanently locked rounding dust. The initial position owner has no operator and its timelock is the maximum uint256. There is no core mint, token transfer tax, admin pause, module replacement, post-launch fee-rate setter, LP withdrawal or migration.

The opening tick is 204200, spacing 200, lower tick -887200 and LP fee zero. This V4 AMM position is the first curve profile. Trading changes its real reserves; range width does not create capital, guarantee growing depth or remove finite liquidity/price limits. Other participants may create their own positions. The permanent lock applies to the original position.

The source implements `IProgrammableClassicLaunchV1` version 1, with the exact existing identity tuple. Its new `ModuleNativeLaunched` event and `programmable.module-mode.native-launch.v1` hash domain distinguish it from earlier Classic and Custom stamp sources. A caller must authenticate the released source address, chain, code, canonical event, receipt and finalized block. Interface conformance alone does not establish Programmable provenance.

`ModuleNativeTokenIdentityBound(launchId,creatorSalt,graffiti)` provides a source-authenticated CREATE2 salt witness even when a smart-contract wallet wraps the launch call; no `tx.from`, outer-calldata or provider trace assumption is necessary.

The extended `getLaunch(token)` record appends `runtime` and `launchKey` to the event fields. `ModuleNativeProgramBound` joins the canonical launch ID to the runtime program key and the exact funding-vector commitment. The runtime's program key is created before the initial buy and is deliberately distinct from the final canonical launch ID.

## Immutable programs and review

`ModuleNativeRegistryV1` admits exact source-package revisions. There is no fee/limit effect-kind enumeration: each selection contains package ID, factory, factory runtime hash, program runtime hash, callback gas and arbitrary bounded configuration bytes. Factories instantiate per-launch program state through `IModuleProgramFactoryV1`; the runtime checks each instance's exact code and complete binding hash.

A revision fixes a reviewed functional family, immutable factory/module code hashes, manifest hash and callback gas. Disabling a revision only stops new registrations. Existing recipes and programs do not read its enabled flag again. A changed program runtime hash fails closed during execution. Neither the review owner nor the launcher can substitute code in an existing launch.

The admission envelope is everything the pinned factory/program constructor accepts. A manifest is a commitment, not an executable onchain configuration validator. Review must assess that complete accepted configuration range and every dependency/control path. If a narrower range is necessary, encode it in the reviewed constructor or a new reviewed factory revision; UI constraints alone do not enforce it. Proxy/mutable-code indirection, ambient Core approvals, unsafe asset assumptions, callback liveness and hidden custody are review responsibilities, not consequences of a matching direct code hash.

Families are keyed by `keccak256(abi.encode(author, salt))`, exactly as in the contributor SDK. A contributor may register its own family, or the existing review owner may call `registerReviewedFamily(author, salt, rewardWallet, submissionDigest)` using the API-authenticated submission. This second route requires author-consent evidence in the review workflow and emits an immutable digest binding. Neither route can overwrite a family. Only the recorded author can rotate the family's future reward wallet. Both author and payout wallet are ordinary nonzero EVM addresses; no platform multisig address format is imposed.

This host admits up to eight distinct functional families, in strict ascending family-ID order, matching the reused fee ledger. The runtime additionally bounds each callback, summed callback gas, per-instance/total configuration bytes and returned data. These are transaction-resource bounds for this engine, not a global catalogue size or an enum of allowed ideas. New market engines and additional capabilities are separate versioned reviewed profiles. A million catalogue entries do not imply a million callbacks in one swap.

## Atomic launch

A launch explicitly supplies `initialBuyNative` and an equally indexed `moduleFunding[]`. Exact `msg.value` must equal initial purchase plus the sum of module budgets. Funding is not taxed as trading volume and cannot be silently diverted from Creator or module-author fees.

The sequence is:

1. Validate metadata, fixed fee steps, nonzero initial-purchase floor, output protection, deadline and exact funding sum.
2. Resolve reviewed selections and canonical distinct families; create the fixed token and locked position recipient.
3. Register the immutable hook recipe and runtime program instances.
4. Fund each requested instance's isolated native vault bucket.
5. Initialize the real V4 pool and mint/verify the permanently locked full-supply position.
6. Execute the initial buy through the immutable authenticated router with real minimum token output and deadline.
7. Record the canonical launch and program/funding event only after every preceding step succeeds.

Any failure rolls back the token deployment, pool initialization, position, fees, program state and budget funding. The configured minimum is an explicit native amount. A current approximate USD conversion and gas estimate are release/quote inputs; the contract does not promise one-dollar gas or invent an oracle. Creator-selected fees also apply to the initial buy.

## Actor and settlement security

`ModuleNativeSwapRouterV1` is permanently bound to one source, one hook and one PoolManager. Each pool snapshots that router and its deployed runtime hash. Other routers are rejected by this hook. This explicit route restriction prevents arbitrary `hookData` from impersonating a buyer.

Public swaps derive actor and payer from `msg.sender`. The sender may choose a separate token/native output recipient. The launch-only initial-buy entry derives the actor from its authenticated source; the hook requires that initial actor to be the recorded launch wallet. Neither `tx.origin`, a wallet supplied by an unrelated router, nor `PoolManager.sender` alone is treated as a human trader.

The router supports native/token exact input and exact output in both directions. It rejects zero output/input bounds, expired deadlines, incorrect native funding and partial fills. Sells use explicit token approval to the fixed router; there is no arbitrary payer or allowance-management API. Native sell proceeds and exact-output refunds are paid after PoolManager unlock completes. A rejecting recipient reverts the complete transaction. Forced native balances stay outside any trader's funding and cannot be consumed or swept.

Every real completed pool swap is delivered once to the runtime with sequence, actor, payer, recipient, gross native amount, actual executed token quantity, direction, exact-input flag and initial-buy flag. The runtime callbacks run inside the still-atomic V4 settlement. A veto or a later settlement/slippage failure reverts all state and accounting. The hook retains a global pending-swap guard through every program callback, and the router and launcher use OpenZeppelin's transient reentrancy guard. Programs have no direct LP or fee-ledger spending capability.

## Native fee equations

Creator buy and sell fees are each fixed at launch in 100-bps steps from 0 through 1000 bps. Mandatory protocol fee is always an additional 20 bps. Zero Creator fee is therefore 0.20% total hook fee; 10% Creator fee is 10.20%. Native ETH is the fee denomination for this engine specifically.

Let `c` be Creator bps, `r = c + 20`, `g` gross native amount and `n` net native amount. A gross basis charges `floor(g*r/10000)`. A net basis derives `g = ceil(n*10000/(10000-r))` and charges `g-n`. Platform portion is `floor(g*20/10000)` when Creator fee is nonzero; Creator receives the remaining hook fee. With zero Creator fee all charged units are platform fees. This preserves exact-output settlement at rounding boundaries.

| Swap | Fee basis | User native amount |
| --- | --- | --- |
| Buy exact native input | Specified gross input | Specified input |
| Buy exact token output | Measured pool native debit, grossed up | Pool debit plus hook fee |
| Sell exact token input | Measured gross pool native output | Pool output minus hook fee |
| Sell exact native output | Specified net output, grossed up | Specified output |

The reused `ClassicModuleFeeLedgerV1` holds fully backed PoolManager native claims. Half of lifetime protocol fees goes to treasury, half is divided equally among distinct selected families. Duplicate family revisions are rejected; helper contracts do not create fee weights. Whole-unit rounding, carried dust and historical claims retain the existing ledger semantics. When no modules are selected, the author half goes to the explicit immutable `noModuleRecipient`; release must bind that policy before deployment.

Creator recipients and their weights are separate. The fixed reward admin or treasury may replace future Creator wallets through the existing revision/deadline-bound CTO API; accrued whole claims stay with their previous owners. This does not change rates, family attribution, module roles or ownership. Author self-rotation likewise only affects subsequent accrual. PoolManager-level protocol fees are controlled by Uniswap's authority and reported separately by `feeComponents`; the UI must quote their actual base instead of adding incompatible pips and bps.

## Initial reviewed examples and management

`TimedWalletBuyCapV1` counts gross native buys by authenticated actor for a fixed opening duration, with a fixed choice whether to include the initial buy. Its constructor accepts `(uint128 capNative,uint64 duration,bool includeInitialBuy)`, nonzero cap and duration from one second through thirty days. Sells remain uncapped. This is a wallet limit, not proof of distinct humans or universal anti-sniping protection.

`EveryNthBuyRewardV1` accepts the new 192-byte tuple `(uint32 everyN,uint128 minimumGrossNative,uint128 rewardNative,uint64 endsAt,bool includeInitialBuy,address refundWallet)`. Amounts/count must be nonzero, end time must be in the future and refund wallet nonzero. Every Nth qualifying buy receives a backed claim for the authenticated actor from that instance's pre-funded bucket. A depleted budget skips that reward without debt or blocking trading. Ordering is predictable and strategic buying is possible.

After expiry, only the launch-bound refund wallet may call runtime `executeAction` with `RECLAIM_UNUSED = keccak256("programmable.module-mode.reward.reclaim-unused.v1")`, empty inputs, its current action nonce and a deadline. It moves only unused available budget into that same wallet's backed pull claim. Winner claims remain intact. Zero available budget is a successful no-op. The wallet then uses the existing vault claim API. There is no platform sweep or automatic transfer to a CTO's personal fee wallet.

Management UI must bind reads/actions to the exact chain, runtime, launch key, instance ID, program revision and current role/nonce. Contribution source, action schemas and instance output claims are separate from mutable catalogue copy. Runtime actions preserve their direct caller as actor; input bytes do not confer Core authority.

## Deployment preparation and remaining release proof

Use the checked-in Solidity 0.8.26/Cancun/1000-optimizer-run profile and exact pinned dependencies. Deploy registry, runtime factory, hook at correctly mined hook-bit address, existing planner/policy/token factory/position-forwarder dependencies, then the router factory and launcher. The launcher constructor takes the reviewed router factory address and its exact deployed runtime hash. The constructor creates its one immutable source-bound router. `ensureRuntime()` is permissionless and has no configurable target; it creates the unique runtime for the already-deployed hook through the pinned fixed runtime factory.

The separate router factory is necessary: embedding router creation originally produced oversized launcher initcode. The final review must check deployed runtime <=24576 bytes and complete initcode including constructor arguments <=49152 bytes. Constructor hash pins, dependency addresses, deployment nonce/salt, engine code hash, registry owner, ledger treasury/admin/no-module policy and the explicit minimum buy all belong in the reviewed payload.

Local tests use a real PoolManager and PositionManager. They cover plain launch/identity/LP lock, both fee extremes and all four swap variants, prefunded reward, cap veto with complete rollback, actor spoofing, router reentry, duplicate family rewards, revision disable/new-only, codehash mismatch, Creator/author future-only wallet changes, separate recipient, deadline and slippage, forced balances, API-family review and post-expiry refund. A 1000-run native roundtrip fuzz test checks fee arithmetic, supply and full native-claim backing. Runtime's additional independent tests cover per-instance budget isolation, replay, callbacks and management actions.

Production still requires independent source review, exact compiler/code-size evidence, full project CI, deployment and source verification, chain capability checks, fresh native-purchase quote policy, reviewed package admission transactions, live quote/launch/swap/claim lifecycle evidence and finalized source-bound indexing. Passing local tests is not any of those external proofs.

## Local static-analysis disposition

At engine checkpoint `2d914a8c`, `slither . --filter-paths 'lib|test|script|src/(?!module-mode/engine)' --exclude-dependencies` completed with 26 reported items: 2 high, 10 medium, 9 low and 5 informational. The command exits nonzero for reported findings; none was hidden with a source suppression or a changed severity rule. Its JSON report is a local generated artifact. The analyzer also logged IR-generation limitations in older contracts outside this engine; this is not a whole-repository clean audit result.

- **High: arbitrary native send in `_fundModules`.** The recipient is the immutable runtime's constructor-created vault, not a destination supplied in launch parameters. The only supplied values are the exact funding vector, bounded to selected instances and included in `msg.value` in addition to the initial buy. Per-instance accounting grants no right to another bucket. `test_fundedInitialBuyRewardAndOrdinaryEvmAuthorWallets`, `test_initialBuySlippageRevertsTokenPoolProgramFundingAndFees` and `test_forcedNativeBalancesCannotBeSpentByAnotherTraderOrLaunch` exercise funding separation, rollback and isolation. The reviewer must still verify the released runtime/factory code and constructor bindings.
- **High: balance comparison after initial-buy router call.** The comparison intentionally checks actual ERC20 receipt after the authenticated route completes. The outer launch and router entrypoints both use OpenZeppelin `ReentrancyGuardTransient`; token code is fixed by the pinned UERC20 factory and contains no receiver callback. A module callback executes before output delivery and receives no token allowance. Smart-wallet, slippage, callback-veto and router-reentry tests cover the relevant boundaries. This is a defensive balance assertion, not a cached value used to grant a withdrawal.
- **Medium: post-call state writes in runtime initialization and pool registration.** Runtime creation goes only through the exact pinned parameter-free runtime factory; its constructor path has no caller-chosen callback. Registration sets `_registering` before any untrusted factory invocation and both registration and swap admission reject nested entry while it is set. Runtime additionally guards its registration/callback lifecycle. The availability flag is cleared only after complete registration. `test_runtimeInitializationCannotBeRedirectedOrRepeated` checks the one-way binding.
- **Medium: `_inCallback` reset after settlement.** The callback hash is consumed before the swap, the callback accepts only PoolManager, nested callback entry is rejected and public router calls remain nonReentrant through the complete unlock and native payout. Native receipt while unlocked is limited to PoolManager. `test_moduleCannotReenterTheAuthenticatingRouter` and `test_unauthenticatedRouterAndSpoofedHookDataCannotBypassWalletLimit` exercise the concrete rejection paths.
- **Medium: implicit zero locals and unused return fields.** Solidity initializes the previous-family sentinel and funding sum to zero. Omitting pool price/tick from a fee-only view, the family array from a recipe-only preview, the initialization return from an idempotent constructor step and the runtime execution ID from a void hook callback does not skip success checking; a reverted/invalid ABI call still fails. The useful identities are stored/emitted by their authoritative contracts.
- **Lower severities.** Loops are bounded by eight admitted families and matching funding entries. Deadline timestamps implement explicit expiry, never randomness. Events after fixed dependency calls retain atomicity. The four swap cases explain router branching; all are exercised at both fee extremes. Long literals arise from exact compiled-code pins.

These are reasoned dispositions for independent review, not an assertion that detector warnings prove safety. The follow-up additionally pins the registry's exact compiled runtime code in the hook constructor, excluding accidental proxy/foreign registry deployment, with a negative test and a repeated initcode-size check.
