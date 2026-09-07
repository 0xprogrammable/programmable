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
PoolManager immutable copies constructor byte offset 256, the first word inside `configuration`. Compiler AST IDs
and runtime offsets are obtained from the actual artifact, not hand-maintained values.

`fixedQuoteAsset != 0` is enforced by the host before construction, and the quote/escrow reference also rejects
an inconsistent fixed quote in its own configuration. `fixedConfigurationHash != 0` rejects every differing byte.
A free quote address lives in Context, so the same fixed infrastructure configuration supports later eligible
quote CAs without another engine revision. Publish the quote reference with a **nonzero fixed configuration hash**:
its PoolManager, PositionManager, planner, lock factory, converter, converter code hash and price convention are
reviewed dependencies. Allowing arbitrary configuration would not constitute admission of arbitrary dependency code.
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
platform and creator amounts use separate floor calculations against 10,000. Platform rate is 10 bps for a
revision without eligible families and 30 bps with eligible families. Creator rates are separate, 0..1000 bps in
100-bps increments. The V2 ledger splits actually received platform ETH 10/0 or 10/20 with its existing cumulative
rounding, author wallet, creator/CTO and historical-credit rules. Merely being an engine/helper/import creates no
family reward slot.

All quote fees are converted in the same successful operation. `TradeLimits` is encoded as
`(uint256 minimumEthFees, uint160 sqrtPriceLimitX96, bytes conversionRoute)`. The reference converter uses the
existing V3 exactInput ABI, verifies a bounded path from the chosen quote to WETH and real pools on the pinned
factory, transfers exactly the operation's quote fees, resets router approval, receives real WETH, unwraps it and
delivers actual ETH. WETH itself uses direct funded unwrap with an empty route. A positive quote fee requires a
positive ETH floor. Existing converter balances cannot stand in for newly delivered output.

The engine proves the quote debit and the actual ETH balance increase, resets its converter approval and forwards
all newly received ETH into `host.depositFees(platformEth, creatorEth)`. It divides converted ETH proportionally
to the charged platform/creator quote amounts; the indivisible final wei remains with creator, while the V2 ledger
handles the separate protocol/author accounting dust. No quote-denominated claim is presented as an ETH claim.
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

The local V4 tests execute the real installed PoolManager/PositionManager implementations. Their funded V3 fixture
uses deterministic exchange rates to prove accounting and rollback; it is not a mainnet route, external price,
provider or independent-audit attestation. Salt-search gas in test helpers is offchain deployment preparation,
not a measured production launch transaction cost.

Required downstream work remains: reviewed compiler/configuration receipts and deployment evidence; source/ABI
publication; signing/transaction preparation; canonical host registration and indexer readback; contributor worker,
SDK, UI and live quote/route integration; provider-backed buy/sell and public acceptance. The quote reference
currently supports exact-input operations. Exact-output, Native-module callback composition, additional asset
roles, strategy/position liabilities and authenticated external/cross-chain inputs are separate concrete profile work; they
are not claimed by accepting an engine package or by this suite passing.
