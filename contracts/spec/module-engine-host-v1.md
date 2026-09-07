# Module Engine Host V1

Status: local source and executable conformance evidence. This document does not assert review admission,
deployment, provider liquidity, indexing, a public UI flow or production availability.

## Purpose and reuse

`ModuleEngineHostV1` is an additional, concrete EVM contribution host. A contributor supplies the engine's
creation code, compiler artifact, configuration and operation implementation. The host deploys and invokes that
code. There is no new effect-kind switch, `delegatecall`, universal instruction interpreter or shared engine vault.

The existing `UERC20Factory` and `ClassicModuleLaunchPolicyV1` are reused with exact runtime checks. Each launch
has one fixed-supply, 18-decimal primary coin with 1,000,000,000 tokens. The host gives the initial supply to that
launch's engine. `coinRights` must be zero: this profile grants no subsequent mint, seizure, upgrade or token-owner
permission. The approved engine's declared market/custody behavior determines use of its initial supply.

`ModuleQuoteEngineV1` reuses `StockPairedPositionPlannerV3`, `LockedPositionFeeForwarderFactoryV1`, the official
PositionManager and the old V3 coordinator's router ABI. The old StockPaired launcher itself cannot meet this
profile unchanged: it fixes six quote addresses, assumes an 18-decimal minimum quote input, and uses the old
quote-denominated fee accounting. Its code and historical deployments are unchanged.

The new host reuses `ClassicModuleFeeLedgerV2` from the Native V2 fee-policy change. Native V1 source, economics,
registries and claims are unchanged. Source dependencies must include that V2 ledger and `ModuleNativeEconomicsV2`.

## Contributor contract

```solidity
constructor(ModuleEngineTypesV1.Context memory context, bytes memory configuration);
function contextHash() external view returns (bytes32);
function initialize(bytes calldata launchData) external returns (bytes32 resourcesHash);
function execute(ModuleEngineTypesV1.Operation calldata operation)
    external payable returns (bytes memory result);
```

`Context` has this exact ABI tuple order:

```text
(address host, bytes32 launchId, address token, address creator,
 address quoteAsset, address feeCollector)
```

The host is the CREATE2 deployer; `feeCollector` is that same host. The creator is the actual launch caller, not the
source contributor. `contextHash()` must equal `keccak256(abi.encode(context))`. `ModuleEngineBaseV1` supplies the
single initialization and host-only invocation checks. Constructor/initialize/execute hooks are normal calls,
never delegate calls. Contributor code remains subject to source review and adversarial conformance; getters and
matching bytecode cannot prove arbitrary business logic or a mutable external dependency safe.

`Operation` has this exact ABI tuple order:

```text
(bytes32 operationId, address actor, address recipient, address inputAsset,
 uint256 inputAmount, address outputAsset, uint256 minimumOutput,
 uint256 deadline, uint256 nonce, bytes data)
```

The host checks `actor == msg.sender`, the deadline and the next per-launch/per-actor nonce. It checks the reviewed
operation's caller class and asset roles, transfers precisely `inputAmount` from that caller directly to the
isolated engine, and verifies both the payer debit and engine credit. Engines receive no wallet or host allowance.
Native input requires exactly `msg.value == inputAmount`; extra ETH cannot subsidize an operation silently.
The final recipient balance must actually increase by at least `minimumOutput`. An engine's returned bytes are
not evidence of payment. A revert rolls back the input, nonce, state changes and fee credits together.

Permissions contain `operationId`, `inputRoles`, `outputRoles`, and `authorization`. Role bits are primary=1,
quote=2, native ETH=4. An ERC20 address declares its role even with a zero amount/minimum. Address zero plus amount
zero means no asset; address zero plus a positive amount means native ETH. A no-output operation uses
`outputAsset=address(0), minimumOutput=0`. Authorization is public=0 or launch-creator=1. The host currently supports
these three asset roles; another custody/resource model needs a reviewed host profile extension.

Configuration/operation data is bounded at 16,384 bytes, operations at 32 and immutable patches at 128. A revision
sets its execution gas limit, between 50,000 and 10,000,000. The quote reference is exercised with 3,000,000 gas for
each initialize/execute call. The host itself is not a transaction relayer or an offchain quotation provider.
Context readback reuses `ClassicModuleCalls.read` for a gas-bounded, exact 32-byte static result. Initialization
accepts at most 32 result bytes; execution accepts at most 16,384 payload bytes plus the 64-byte dynamic ABI header.
Revert diagnostics are capped separately at 4,096 bytes. `ModuleEngineCallsV1` checks returndata size before
copying it, so a reviewed-but-defective contributor cannot force an unbounded result allocation in the host.

## Code, constructor and template binding

The existing native registry's current `owner()` controls engine admission. The host introduces no separate
review administrator. Revisions are append-only; availability changes apply only to future launches.

Every approved revision binds:

- existing family ID and reviewed manifest hash;
- exact `keccak256(creationCode)` and unpatched runtime-template hash;
- ordered, non-overlapping 32-byte compiler immutable locations and their constructor-word offsets;
- permitted operations, input money rights, zero coin rights and an optional required initial operation;
- optional fixed quote CA and fixed configuration hash;
- the sorted, unique, bounded set of eligible fee families explicitly admitted for that revision.

The review worker must derive immutable locations from the exact solc artifact and prove each binding to the
appropriate constructor field. It must not accept arbitrary caller-written runtime offsets as compiler evidence.
At launch the host builds `abi.encode(context, configuration)` itself. Each registered immutable location must
contain zero in the exact approved runtime template; the host copies the corresponding 32-byte constructor word.
The resulting full runtime hash must equal the actual deployed code hash. No per-launch caller-supplied expected
runtime hash is trusted. Storage-constructor engines use an empty immutable map and one constant runtime hash.

The CREATE2 salt is `keccak256(abi.encode(actualCreator, suppliedEngineSalt, launchId))`; the complete initcode is
`creationCode || abi.encode(context, configuration)`. The host stores constructor, initcode and concrete runtime
hashes and checks the concrete runtime again before every operation. For the quote reference the BaseHook
PoolManager immutable copies constructor byte offset 288. The dynamic Configuration tuple adds a 32-byte ABI
offset before its first field inside `configuration`. Compiler AST IDs
and runtime offsets are obtained from the actual artifact, not hand-maintained values.

`fixedQuoteAsset != 0` is enforced by the host before construction, and the quote/escrow reference also rejects
an inconsistent fixed quote in its own configuration. `fixedConfigurationHash != 0` rejects every differing byte.
A free quote address lives in Context, so the same fixed infrastructure configuration supports later eligible
quote CAs without another engine revision. Publish the quote reference with a **nonzero fixed configuration hash**:
its PoolManager, PositionManager, planner, lock factory, converter, converter code hash and price convention are
reviewed dependencies. `host.fixedConfigurationHash(launchId)` returns the admitted revision's fixed hash; the
quote engine's initialization compares it with its actual constructor configuration hash. An unfixed revision
cannot initialize this profile. Allowing arbitrary configuration would not constitute admission of arbitrary dependency code.
Fixed and free templates use the same contribution/approval/launch path.

## Reference quote market and fees

The quote engine implements `keccak256("spot.buy.exact-input.v1")` and
`keccak256("spot.sell.exact-input.v1")`. The first operation is an atomic funded buy. Both currency address orders
work. Its V4 hook permits initialization only by itself and swaps only while its own host-authenticated operation
is active. Calling a generic PoolSwapTest/Universal Router cannot bypass the host or fees.

The price configuration is whole quote units per whole primary token, scaled by 1e18. The engine resolves the
actual quote decimals, calculates the raw-asset price ratio rationally and rounds the absolute tick down to the
planner's 200-tick spacing. It does not round the quote amount per primary token to a whole raw unit first.
Consequently, a 6-decimal quote can correctly price one token below one raw quote unit. Display/integration must
use the actual tick and resulting executable price, not promise the unrounded requested price. The one-sided
planner requires a positive usable absolute tick; the engine explicitly rejects prices outside that profile.

The primary supply is placed in a position owned by the existing permanent-lock forwarder. The engine validates
the factory record, zero operator, maximum timelock, fee recipient, PositionManager, actual NFT owner, ticks,
liquidity and pool ID. A correctly predeployed forwarder is reused, preventing a public factory call from blocking
a later launch. LP fee pips are zero. Extra token dust remains under the existing lock behavior.

The initial buy and each buy charge on gross quote input. A sell charges on actual gross quote output. Quote
platform and creator amounts use separate, **exact cumulative modulo-10,000 carries**, stored by launch and
buy/sell direction, shared across actors. A trade receives the fee amount that its actual basis and the previous
remainder make payable. Splitting across trades or wallets cannot discard fractional quote fees. The public
`quoteFeeRemainders(bool buy)` getter returns the platform and creator numerators. If both carries mature on a
tiny operation and the fees consume its entire input/output, it reverts atomically without changing carries,
nonces or balances; reserves cannot subsidize the missing input. Platform rate is 10 bps for a
revision without eligible families and 30 bps with eligible families. Creator rates are separate, 0..1000 bps in
100-bps increments. The V2 ledger splits actually received platform ETH 10/0 or 10/20 with its existing cumulative
rounding, author wallet, creator/CTO and historical-credit rules. Merely being an engine/helper/import creates no
family reward slot.

The quote `Configuration` tuple has this exact order:

```text
(address poolManager, address positionManager, address positionPlanner,
 address positionForwarderFactory, address converter, bytes32 converterCodeHash,
 uint256 initialQuotePerTokenX18, address fixedQuoteAsset, bytes feeConversionRouteSuffix)
```

The fixed suffix is a single V3 fee tier plus WETH address (23 bytes). The engine prepends the actual Context
quote CA and exposes `feeConversionRoute()`. Thus a new CA uses the same reviewed configuration and its own
factory-derived direct Quote/WETH pool, without an address list or new per-CA source approval. WETH itself uses
an empty execution route and a funded 1:1 unwrap. There is no trader-selected intermediate asset or fee tier.

All payable quote fees are converted in the same successful operation. `TradeLimits` retains its ABI:
`(uint256 minimumEthFees, uint160 sqrtPriceLimitX96, bytes conversionRoute)`. The provided route must equal the
engine's configured route byte for byte, even when the quote carry has not yet produced a whole fee unit. A
trader's ETH floor can only tighten the independently derived floor; it cannot replace or lower it.

`ModuleV3FeeOracleV1` adapts V3's cumulative tick/liquidity interface, reusing the existing
`LiquidityGrowthFullRangePolicyV3` time/deviation/impact constants and Uniswap TickMath. Existing local oracle
contracts use V4 hook-specific interfaces and cannot read a V3 pool directly. The concrete V3 guard requires:

- A direct pool from the pinned factory with matching factory, token ordering and fixed fee tier, at most 1% LP fee.
- A successful `observe([1800,300,0])` proving real 30-minute and 5-minute history, populated cardinality at least 2,
  and allocated observation capacity at least 192. Allocated capacity alone is not evidence of history.
- The latest **written** observation is at most 300 seconds old. `observe(0)` extrapolation cannot refresh it.
- Short/long averages differ by at most 50 ticks; pre-swap spot differs from the long average by at most 100 ticks.
- At least 10 ETH of trusted depth: the minimum of actual WETH balance and virtual WETH depth calculated from the
  smaller current/harmonic liquidity at both allowed price boundaries. Fee notional is capped at 10 bps of that depth.
- After conversion, spot moves at most 25 integer ticks and remains within 125 ticks of the long average;
  at least 10 WETH remains in the pool. A failure rolls back the swap and all claims.

The minimum ETH output uses the adverse 125-tick boundary of that quote-specific long average, accounts for the
fixed pool LP fee and rounds upward. It does not use a universal ETH price per quote unit. The converter exposes
`quoteConversion(address quoteAsset,uint256 quoteAmount,bytes route)` returning
`(uint256 minimumEth,uint256 twapEth,bytes32 observationHash)`. Execution recomputes those conditions from current
pool state. `FeeConversionObserved` records the actual pool, observation hash, fee input, enforced minimum and ETH
received. Initialization and zero-whole-fee operations also validate the market for one raw fee unit, so they
cannot admit an unusable fee route through the rounding branch.

This is a bounded same-pool historical price policy, not external fair value or an unmanipulable oracle. A new
CA must acquire mature, recent and sufficiently deep direct liquidity; missing history, stale observations,
insufficient depth, large fee-sale notional or excessive price movement fail closed. Historical manipulation
within those economic assumptions remains a release-review consideration. The rate may differ arbitrarily
between qualified quote CAs; no fixed ETH rate or per-CA review is required.

The converter transfers precisely the operation's quote fees, resets router approval, receives real WETH,
unwraps it and delivers actual ETH. Existing converter balances cannot stand in for newly delivered output.
Its router dependency uses only SwapRouter02's V3 `exactInput((bytes,address,uint256,uint256))` interface,
selector `0xb858183f`, with fields `path`, `recipient`, `amountIn`, `amountOutMinimum`. The older SwapRouter
deadline tuple (`0xc04b8d59`) is incompatible; no fallback router or selector is attempted. The external converter
interface retains `convert(quoteAsset,quoteAmount,minimumEth,deadline,route)` and rejects an expired deadline
before dependency checks, approvals or transfers. The host separately checks the operation deadline, which the
engine forwards to this conversion. The reviewed nine-field configuration is unchanged. Router/factory/WETH
addresses and runtimes are still bound in the converter constructor and rechecked during execution.

The engine proves the quote debit and the actual ETH balance increase, resets its converter approval and forwards
all newly received ETH into `host.depositFees(platformEth, creatorEth)`. It divides converted ETH according to
the actual charged platform/creator quote proportions. A separate Q128 fractional platform carry per direction
preserves tiny ETH entitlements across conversions, including changing quote proportions. Its additional
truncation is strictly less than `2^-128` wei per conversion; only the quote carry is mathematically exact.
Every actually received wei is allocated in the same call and platform plus creator equals received ETH;
the carry is a rounding accumulator, not an unfunded ETH claim. `platformEthRemainderX128(bool buy)` exposes it.
The V2 ledger handles the separate protocol/author dust. No quote-denominated claim is presented as an ETH claim.
Missing route, insufficient funded WETH/ETH, bad output reporting, fee slippage, pool partial fills or user output
slippage revert the entire trade. External conversion costs affect actual ETH proceeds and need a real live route.

## Independent non-trade references

`ModuleQuoteEscrowEngineV1` demonstrates a different operation model through the identical contributor ABI.
`escrow.deposit.v1` accepts an exact funded quote amount and records an actor-scoped liability.
`escrow.withdraw.v1` releases only that actor's own credit after the configured time. The recipient and withdrawal
amount are bounded by the signed operation and actual output check. Another launch/actor cannot withdraw it.
It is a no-market conformance profile; its primary supply remains locked. Deposits and withdrawals do not invent a
swap fee basis or accrue fictitious swap fees.

`ModuleQuoteSettlementEngineV1` supplies an actual, separate-transaction request/fulfill/refund path. The API's
earlier queue regression fixture had only a global pending amount and lacked payer, beneficiary, job, refund and
deadline isolation, so it was not copied into product code. The deployable reference instead extends the same
small host/base/ERC20 boundary with one bounded request record; it is not a general workflow interpreter.

Its configuration is `(uint256 minimumWindow, uint256 maximumWindow)`, with a positive minimum and a maximum
of at most 365 days. Review binds those values through the revision's fixed configuration hash. The operation ABI is:

| Operation ID hash input | Data | Authority and asset effects |
| --- | --- | --- |
| `settlement.request.v1` | `abi.encode(address beneficiary, uint256 refundAfter, bytes32 obligationHash)` | Payer supplies exact quote input. No immediate output. Beneficiary, nonzero obligation hash, amount and bounded refund time are immutable per request. |
| `settlement.fulfill.v1` | `abi.encode(bytes32 requestId, bytes32 evidenceHash)` | Launch creator only, before refund time. No input. Exact quote output, minimum and recipient must match the recorded amount and beneficiary. Nonzero evidence hash records the creator's attestation. |
| `settlement.refund.v1` | `abi.encode(bytes32 requestId)` | Recorded payer only, at or after refund time. No input. Exact quote output and recipient must match the recorded amount and payer. |

`requestIdFor(payer, nonce)` hashes chain, host, launch, engine, payer and request-operation nonce. `requests(id)`
returns `(payer, beneficiary, amount, refundAfter, obligationHash, status)`, where status is Missing=0, Pending=1,
Fulfilled=2 or Refunded=3. `SettlementRequested`, `SettlementFulfilled` and `SettlementRefunded` expose transitions.
Effects precede payment, both sides of payment are exact, aggregate liabilities remain covered, and the terminal
status prevents both a repeated settlement and a later refund of a fulfilled request.

The payer explicitly relies on the immutable launch creator to attest fulfillment. The creator can only pay the
beneficiary the payer bound, cannot extend expiry or change obligations, and loses the fulfill path at expiry.
This uses the existing creator caller class and grants no new global administrator, fee or withdrawal right.
`evidenceHash` is an audit trail of that attestation, **not an independently verified oracle, service-completion or
cross-chain proof**. A package promising such a verified external input must supply and prove that extra adapter.
Requests and refunds retain the no-market profile's explicit absence of swap fees.

## Provenance and integration

`EngineLaunchBound` binds source host, chain-derived launch ID, primary token, creator, quote, engine, revision,
constructor/init/runtime/configuration/resources hashes, economics policy and `planHash`. The plan hash is
`keccak256(abi.encode(chainId, host, actualCreator, LaunchParameters))`, including the actual initial operation,
fee configuration, metadata and deployment inputs. `getLaunch(launchId)`, `launchIdOf(token)` and
`engineLaunchId(engine)` provide canonical readback. This source does not impersonate Native V1 or a Launch Stamp.

Every successful launch additionally emits exactly one
`EngineLaunchParametersBound(bytes32 indexed launchId, bytes encodedParameters)` from the host, containing
`abi.encode(LaunchParameters)`. An indexer can decode it and independently reconstruct the plan, constructor,
initcode, patched runtime and CREATE2 address without assuming a direct EOA transaction. The source transaction
may enter through a Safe or multicall. Indexing requires this event and the canonical `EngineLaunchBound` plus
host readback/runtime authentication from the same successful receipt.

The encoded parameter limit is 113,984 bytes; the event's dynamic-bytes ABI envelope adds 64 bytes. Its maximum
is derived from existing bounds: 7,744 bytes of tuple/array/metadata ABI overhead and permitted metadata payloads;
48,896 bytes for creation code plus padded configuration (EIP-3860's 49,152 minus the 256-byte constructor header);
24,576 bytes for the EIP-170 runtime; and 16,384 bytes each for launch and initial-operation data. Constructor and
runtime limits are checked before CREATE2, and initial-operation data remains bounded even when its operation ID
is zero. Permission/immutable arrays belong to revision approval, not launch parameters. The emitted encoding is
checked against this derived limit; there is no new unbounded receipt payload.

The quote engine supplies `poolKey()`, `poolId()`, `positionTokenId()`, `positionRecipient()`, `quoteDecimals()` and
`initialAbsoluteTick()`. `QuoteTradeSettled` is meaningful only after authenticating the engine against this host's
launch record and concrete runtime hash. `EngineOperationExecuted` binds actor, nonce, recipient, asset addresses,
raw amounts and result hash. Ledger V2 accounting uses this launch ID as its ledger pool key. Source registration,
canonical indexing and provider activation must explicitly adopt these fields.

## Local evidence and remaining integration

Run from the repository's `contracts/` directory:

```sh
forge test --match-path 'test/module-engine/*.t.sol' -vv
forge fmt --check src/module-engine test/module-engine
```

The suite covers exact creation/runtime/context binding, storage and compiler-immutable profiles, late quote CAs,
free/fixed values, zero coin rights, actor spoofing, nonce replay, deadline, direct engine invocation, runtime drift,
sender/receiver transfer taxes, reentrancy, cross-launch escrow isolation, active historical revisions, exact funded
ETH claims, 10/0 and 10/20 economics, both address sorts, 6/18 decimals, price below a raw quote unit, atomic initial
buy/sell, route underpayment, insufficient route liquidity, output slippage, unauthorized swap routers and
predeployed canonical LP locks, and funded request/fulfill/refund settlement. Settlement adversarial checks cover
recipient and amount redirection, early refunds, late fulfillment, unauthorized actors, replay, cross-request and
cross-launch isolation, missing obligations and failed transfers without closing the request.
The host also rejects oversized success and revert payloads without consuming the actor's nonce. Receipt tests
reconstruct a smart-wallet launch from its single canonical parameter event and verify the exact encoding ceiling.
A 1,000-case round-trip fuzz test reconciles received ETH, ledger backing,
unallocated rounding, engine/converter balances and cleared allowances with creator rates from 0% through 10%.

The local V4 tests execute the real installed PoolManager/PositionManager implementations. Adversarial V3 fixtures
cover bad history, stale observations, thin liquidity, different CA values, route substitution, low output, impact
and rollback. `ModuleQuoteRealV3.t.sol` also deploys the unmodified `@uniswap/v3-core@1.0.1` factory bytecode and
executes actual V3 pool mint/swap/observation logic through a narrow test caller. It proves two launches with the
same revision/configuration and a later 6-decimal CA worth 1000 times less per whole unit, real insufficient
history/freshness failures and rejection after a post-preview price manipulation. Upstream bytecode/source/license
pins are in the test fixture; these local pools are not mainnet/provider or independent-audit evidence.
The helper uses the same four-field SwapRouter02 call; its deadline protection belongs to the converter and host.
Salt-search gas in test helpers is offchain deployment preparation,
not a measured production launch transaction cost.

`ModuleQuoteRouter02RobinhoodFork.t.sol` adds an opt-in fixed-block compatibility check against the actually
installed Robinhood SwapRouter02, V3 factory, WETH and USDG/WETH 500-fee pool. Run it explicitly with:

```sh
MODULE_ROUTER02_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
  forge test --match-path test/module-engine/ModuleQuoteRouter02RobinhoodFork.t.sol -vv
```

The fork selects L2 block 56,934,125, hash
`0x913b7baa5ac1854dd2ef51cc9273307e1638b8bfbf742afb1bc5c45abcf59a93`, timestamp 1,788,794,192. Orbit's `NUMBER`
opcode exposes the parent L1 height 25,926,312 at that snapshot; the test distinguishes it from the L2 RPC height.
The separate heights follow the documented [Arbitrum/Orbit block-number behavior](https://github.com/Uniswap/blocknumberish).
It checks the actual router/factory/WETH runtime hashes before constructing the local converter. With only its
test-account USDG balance funded locally, one USDG converts into 402,501,997,655,607 wei of actual ETH against an
enforced minimum of 397,144,151,975,266 wei. Both converter token balances, its ETH balance and allowances are
zero afterward. Separate cases prove the deployed router rejects the former deadline tuple and that an expired
converter call preserves approved funds. All three cases passed at this snapshot; without the explicit RPC
variable this fork suite is skipped. No transaction is broadcast. This historical local fork is compatibility
evidence, not current market qualification, finality, a deployed converter, or two published live quote launches.

Required downstream work remains: reviewed compiler/configuration receipts and deployment evidence; source/ABI
publication; signing/transaction preparation; canonical host registration and indexer readback; contributor worker,
SDK, UI and live quote/route integration; provider-backed buy/sell and public acceptance. The quote reference
currently supports exact-input operations. Exact-output, Native-module callback composition, additional asset
roles, strategy/position liabilities and authenticated external/cross-chain inputs are separate concrete profile work; they
are not claimed by accepting an engine package or by this suite passing.

## Quote infrastructure deployment preparation

The Core Host release deploys its Host and Ledger. The Quote profile also needs the existing
`StockPairedPositionPlannerV3` implementation and `ModuleQuoteEthConverterV1` bound to the installed Robinhood
SwapRouter02. The earlier Classic native planner is a different implementation and cannot fill this role.
`contracts/scripts/module-engine/quote-prepare.mjs` prepares exactly these two contracts, in that order. A
`ModuleQuoteEngineV1` instance is still deployed by the Host for each launch; there is no global example engine.

The new plan has the exact schema `programmable.module-engine-quote-deployment-plan.v1`. Its separate
`programmable.module-engine-quote-infrastructure.v1` identity contains only `positionPlanner` and `converter`
as new roles and seven retained dependency pins. It is not a canonical launch-source release or an economics
policy. The script does not create fee, review or administrator rights. The gas payer is bound to the existing
source-controlled deployment-owner basis. Both transaction values are zero; each actual EIP-1559 gas allowance
and maximum fee still requires fresh simulation, sufficient owner ETH and explicit owner-reviewed ceilings.

The planner has no constructor arguments. Its runtime must reproduce the `type(StockPairedPositionPlannerV3).runtimeCode`
embedded in the public Quote Engine's constructor. The deployment sealer therefore reads the committed public
Engine review settings and recompiles both targets with Solc 0.8.26, optimizer 1000, Cancun, `viaIR: true` and
`metadata.bytecodeHash: none`, leaving CBOR at the compiler's default. A default non-viaIR Forge planner does
not satisfy that binding. The sealer derives the actual 107-source import closure without changing source bytes,
checks the embedded full planner runtime, and separately reproduces the planner from its 32-source publication
input. The resulting reviewed-profile planner has 7,851 bytes of runtime and 7,877 bytes of initcode. The Quote
Engine has 16,429 bytes of runtime and 29,478 bytes of creation code; its canonical nine-field configuration adds
640 constructor bytes for a complete 30,118-byte initcode. These are local compiler-parity checks, not an
accepted source submission or a successful isolated Quote lifecycle review.

The deployment helper currently pins the native Darwin Solc binary. The protected review worker instead pins
`solc/soljson.js`; that Wasm file is not an executable native compiler and cannot be passed as `MODULE_MODE_SOLC`.
A native Linux deployment compiler requires its own verified binary pin before this helper can support it.

The converter retains its already verified non-viaIR, no-CBOR build profile because its runtime is explicitly
bound by `converterCodeHash`, rather than compared to an embedded `type(...).runtimeCode`. Its full compiler
input and metadata accompany its separate source-verification request. The converter constructor has exactly `(address router,address weth)`;
its deployed runtime binds the router, router factory and WETH addresses plus all three code hashes. Both new
addresses are CREATE2 predictions through the existing `0x4e59b44847b379578588920ca78fbf26c0b4956c` deployment
proxy. A prediction alone does not authorize the proxy: preparation uses its pinned runtime and the operator
rechecks that runtime before every wallet request. The retained V4 PoolManager, PositionManager, locked-position
factory, V3 factory, SwapRouter02 and WETH runtimes are also checked at one common block. The PositionManager,
locked-position factory and router getters must reproduce their expected links. Stage 1 requires the exact stage 0
planner runtime. A matching occupied target requires its actual receipt; it never becomes a fresh deployment request.

The official WETH address is a `TransparentUpgradeableProxy`. Its outer runtime hash does not bind the current
implementation or make that implementation immutable. Every Quote stage and included-receipt observation also
reads the EIP-1967 implementation and admin slots, then the complete implementation runtime, through the same two
providers at the same block used for the outer pins. `quoteBindings.wethProxy` records those slot words, addresses,
implementation bytes and hash, and block identity. Missing, disagreeing, noncanonical or empty-code observations
fail closed; deployment evidence used to bind source requests must retain the internally consistent snapshot.
This is an observation, not a new hardcoded implementation allowlist or a guarantee that later upgrades cannot
occur. The external proxy administration can change WETH behavior or availability after that block, while its
outer code hash remains unchanged. An observed admin address alone does not establish the ultimate executor's
governance permissions. A release using this dependency retains that external upgrade assumption. The converter's
actual ETH receipt, exact allowance/residue and atomic fee-funding checks still apply to completed operations;
they do not prove unchanged external implementation semantics. This observation adds no contract or fee rights.

The deployment preparation reuses the existing pinned compiler sealer, complete Git-object source equality,
historical locked-position-factory source closure, independent provider custody, owner wallet requests, journal,
receipts and source readback. The shared operator dispatch recognizes this exact fourth schema and only these two
zero-value stages. Existing Native V1, Native V2 and Core Engine policy checks remain unchanged. The preview shows
only the gas payer, constructor/source commitments and all nine infrastructure runtime pins. The inherited
same-nonce retry path retains every original wallet field. Operator-only continuation under a different source
commit is currently unsupported for this infrastructure schema and fails closed in the unchanged recovery policy.

From a clean committed checkout, prepare unsigned files without selecting a trading price implicitly:

```sh
MODULE_MODE_FORGE=/absolute/path/to/pinned/forge \
MODULE_MODE_SOLC=/absolute/path/to/pinned/native/solc-0.8.26 \
  node contracts/scripts/module-engine/quote-prepare.mjs --output /absolute/new/output/directory
```

Optional `--parameters FILE` requires exactly `owner` and `releaseLabel`; the owner must equal the inherited
deployment owner. The default label is `robinhood-engine-quote-v1`. Optional `--review-configuration FILE`
requires exactly `initialQuotePerTokenX18` (positive decimal uint256 string) and `feeTier` (100, 500, 3000 or 10000).
It produces the exact nine-field root tuple `ModuleQuoteEngineV1.Configuration`, with the mandatory leading ABI
offset for its dynamic suffix. Infrastructure addresses and converter code hash are derived from the plan.
`fixedQuoteAsset` is zero for a free CA and the suffix is exactly `uint24(feeTier) || WETH`. The reviewed revision
must enforce the resulting fixed configuration hash; changing CA does not permit changing route, price or
dependencies. Without explicit price/tier input, the output contains configuration requirements and ABI but no
invented fixed configuration. Neither form approves or publishes a revision. The actual market for each selected
CA must separately pass the converter's current history, liquidity, freshness and impact checks.

`review-compiler-parity.json` records the actual compiler settings, binary hash, full input digest, Engine sizes
and embedded planner hash. `quote-review.standard-input.json` is the exact complete source inventory used for
this local profile check. The retained `build.artifacts.reviewEngine` is only the initial non-viaIR source-inventory
artifact; actual public Engine byte comparisons must use the IR hashes in `review-compiler-parity.json`.
The contributor review must use the same source bytes and independently bind its own
actual subject, request, compiler input, operation cases and results. Source transport or compiler parity alone
does not provide the V4/router dependencies or address-bit-qualified CREATE2 instance required by a real Quote
constructor in the isolated worker. The protected review policy is not relaxed by this deployment package.

The emitted `simulation-input.bin` reuses `script/module-mode/SimulateModuleNativeDeploymentV1.s.sol` for local
fork execution of both exact zero-value calls and all nine resulting/retained runtime hashes. Its name does not
change the ABI: this generic simulation runner signs and broadcasts nothing. Its logged local call gas is not a
transaction estimate or approved fee ceiling. Candidate mode remains explicitly unusable by the live operator.

After owner-controlled deployment, `quote-collect.mjs observe/record --plan FILE --step 0|1` uses the reviewed
provider quorum and, for recording, the protected `--journal DIRECTORY`. `deployment` requires both actual journal
transactions, canonical receipts and same-block runtime/getter readback. `source-requests` binds each new source
submission to its own exact creation transaction; `source` additionally validates the published full compiler
input, constructor, runtime and exact historical Forwarder source evidence supplied by `--previous-source FILE`.
These commands write separate infrastructure evidence with an `infrastructureDigest`, never a launch release
digest. Included code, Ethereum finality, source publication, template approval/publication and two actual D10
launches remain distinct proofs. No prepare, observe, collect or simulation command submits a transaction or
publishes a source bundle.
