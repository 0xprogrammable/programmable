# Open Classic module architecture: implementation requirements

Status: architecture specification, 5 September 2026. The general stateful module lifecycle below is **not implemented** by `IClassicModuleV1`. The new common identity reader is implemented separately in `IProgrammableClassicLaunchV1`. Existing launch/fee tests do not establish the proposed lifecycle's correctness. The current two-effect ABI is a limited prototype and must not be frozen as the public open-module foundation.

The [open-package SDK candidate](../../packages/classic-modules/OPEN-PACKAGES.md) implements the first local source/configuration step: pinned source bytes, structured inputs, explicit asserted bindings, preparation links and configuration constraints. Its successful output remains an unreviewed, non-launchable preview. It does not implement the stateful lifecycle or make management declarations executable.

The subsequent [configuration and contribution gap review](classic-configurable-packages.md) specifies template/instance separation, typed roles and structured inputs, canonical financial allocation, the CTO/module-funding conflict, generic post-launch actions and source-first contribution acceptance. Those requirements are part of this architecture; a descriptor with arbitrary business names alone does not satisfy them.

The [website integration requirement](classic-configurable-packages.md#required-website-integration-and-documentation) additionally makes complete reads, management/actions, role/control policies, host requirements, documentation and a local UI preview part of every available contribution. Launch-bound immutability protects the selected rules and their control policy; it does not forbid executing expressly permitted controls under those rules. Previously fixed parameters do not become editable through this clarification.

The [cross-cutting perspective requirements](classic-configurable-packages.md#cross-cutting-launch-assurances-usability-and-operation) bind truthful launch assurances and market scope, continued compatibility after control changes, effective code immutability, permanent-failure behavior, shared authority effects, whole-path costs and funded operating duration. They also define a common trader/creator flow and measurable contributor usefulness. These requirements extend the candidate specification; they are not a certification of arbitrary combinations or of the current prototype.

## Product contract

A Classic launch has one canonical token and primary bonding-curve pool. Its launch-time recipe may bind multiple modules and supporting contracts. Adding a reusable module using supported execution primitives must not require changing the token, launcher, hook, common identity reader, indexer identity schema, or a handwritten frontend form. Catalogue size is not a runtime instruction to execute every entry.

The contributor supplies ordinary program logic. The platform must not add business-feature discriminators such as `NEXT_BUYER_REWARD` to recognize each new idea. A versioned lifecycle exposes initialization, trade preparation, trade completion, and module-specific actions. Each instance owns its own state. A common, bounded protected-action interface controls effects on funds and core state.

New protected actions or fundamentally different settlement models can require a separately reviewed adapter/engine revision. Contributors may supply that adapter or engine as part of a package through the same intake and catalogue; this is a first-class extension path. Existing recipes must bind that revision immutably. Compatibility is not permission to reach arbitrary shared storage, execute `delegatecall` in the core, spend another module's balance, withdraw the base LP or bypass fees.

## Open program packages, small protected core

Openness is a requirement on executable contributions, not the number of names accepted in metadata. A package can contain ordinary program logic, per-launch state machines, multiple contracts, callable actions, dependencies and external services. It may contribute market construction and execution as well as behavior within an existing engine. The supported business ideas are not a kernel enum, and new logic must not need a kernel branch solely because its semantics were unforeseen.

Separate these responsibilities:

- **Protected core:** authentic origin, immutable launch bindings, authenticated rights, protected asset movements and enforceable platform/author/creator accounting. It does not interpret business-feature names.
- **Composition standard:** versioned inputs, outputs, units, events/actions, dependency edges, resource ownership, initialization and configuration, resolved into an exact launch recipe.
- **Contributed components:** the actual market/application logic and integrations. A component can use other components through explicit interfaces. A package may include the immutable engine or hook implementation needed to coordinate them.

The first native implementation targets Robinhood and a primary V4 bonding-curve market. Native ETH quoting, the existing engine's callback subset and its price algorithm are not permanent requirements of the package model. New launches can select different admitted engine implementations while sharing origin and accounting requirements. This does not change the source or hook of an existing launch, nor claim that one EVM implementation executes another chain's runtime.

Required contract-level specifications, to be implemented before public standardization:

| Boundary | Required contents and enforcement |
| --- | --- |
| Package descriptor | Exact code/build/dependency revisions, author family, configuration schema, provided/required versioned interfaces, assets and units, entrypoints, deployment components, failure model and review envelope. Describing a capability does not implement or grant it. |
| Execution context | Authenticated launch, recipe, component, action/phase, execution ID, actor/payer/recipient, authorizations, actual amounts and routing assumptions. Modules cannot forge core facts. |
| Capability grant | The specific component, resources, assets, amounts, operation scope and expiry/lifecycle restrictions it may exercise. Protected operations authenticate the grant and actual backing; a contributor cannot self-grant authority through its manifest. |
| Resolved launch recipe | Exact admitted implementations, initialization, interface connections, operation order, fund allocation, trigger/failure rules and common identity. It binds engine/hook permissions before pool creation. |

These are design boundaries, not implemented ABI declarations. The composition resolver must produce a deterministic commitment which the onchain launch path validates. Its offchain judgement must not be the sole authority for financial grants or allowed code. Interfaces between components include type/unit checks and explicit ownership of shared resources; semantic and economic interactions additionally require review.

A component may call its own contracts and external protocols within its declared and reviewed authority. It never runs arbitrary code in the protected core's storage context or inherits a reusable allowance over another component's funds. A protected resource needs a specific operation boundary; arbitrary calldata is not a new protected capability. New business logic using existing rights is an ordinary package contribution. A genuinely new protected primitive needs an audited, version-bound adapter or engine extension for future launches.

The common standard and proven protected invariants can remain stable while contributed code varies. A requirement for one identical universal hook bytecode across every future launch would contradict this extension path. Existing token, base-LP, fee and post-launch immutability commitments remain constraints of the Classic profile; the request for experimental logic does not silently repeal them.

## Required execution context

The lifecycle starts with market construction. A package may supply a launch variant that chooses the quote asset, curve configuration, initial acquisition path and supporting components before the primary pool is created. Existing trade callbacks alone are not the open architecture. See [launch variants, assets and services](classic-launch-variants.md) for the required asset-independent construction and accounting boundaries.

The action model also accommodates declared liquidity actions, explicit user actions, component-to-component calls and authenticated external messages. The resolver binds supported triggers to the selected execution implementation and its reviewed permissions. Scheduled work requires an actual caller and funding; contracts do not execute themselves. External work uses explicit request/confirmation/retry transitions and cannot be described as atomically reversible with a completed swap.

The engine authenticates and binds an execution ID, chain, source, pool, recipe, module instance, lifecycle phase, direction, actor, payer, token recipient, payment authorization and slippage/deadline limits. The completed context contains measured executed amounts. The module does not establish these facts by returning an arbitrary address or amount.

`msg.sender` in a V4 callback is the PoolManager; the callback's `sender` is generally its router. In the current Classic initial buy, it is the launcher. Current V1 ignores `hookData`, so it supplies no authenticated end-user identity to a module. A caller address in unverified `hookData` must not qualify for rewards or spend another user's authorization.

A first implementation may use an immutable execution adapter which authenticates its caller or a tightly scoped signed authorization. Other routers need an equivalent proven context. A recipe requiring actor identity must declare whether unsupported routes are rejected or are non-participating; they must never acquire a fabricated actor. That routing consequence belongs in configuration and review, not a hidden fallback.

## State and money boundaries

- Each module instance has isolated state and an explicitly funded budget. Module-specific contracts can implement additional behavior within their granted scope.
- Before/after phases bind the same execution and run in deterministic recipe order. A successful execution is applied at most once.
- Swap, state transitions, funding, core fees and reward credits succeed or revert together. The guard must cover the whole lifecycle, including external module calls; deleting the current V1 pending slot before a new callback is not sufficient protection.
- Protected operations may fund a module budget or credit a beneficiary from that budget. The operation checks actual backing and cannot spend another instance's assets or existing claims.
- Swaps create backed claims; claim recipients are not called during the swap. A rejecting recipient must not freeze trading.
- Resource limits cover callback gas, state/return-data exposure, operation count and transaction size. They must be measured and published for the selected execution profile; growing the catalogue does not add every catalogue entry to a swap's execution.
- The selected immutable code revision, dependencies, initialization, execution order, funding rules and failure behavior belong in the recipe. Catalogue approval updates apply only to new launches.

The fixed 20 bps assessment retains its 10 bps Programmable and 10 bps equal-per-selected-family author allocation. Module budgets have an explicit additional source. Splitting one module implementation into internal helper contracts does not create extra paid module families. New action paths must independently prove correct fee coverage; the native V1 swap formula proves nothing about an unspecified future settlement model.

## Next-buyer example as an acceptance scenario

The user's “the next buyer receives 10 dollars” is an illustrative idea, not approval of a fixed native fee, USD oracle, contribution rate or eligibility policy. The architecture must support this sequence after those module-level choices are specified:

1. Qualified buyer A completes a buy and contributes `c_A` under the launch-bound funding rule. The pending pot becomes `c_A`; there is no previous reward to claim.
2. Qualified buyer B completes a buy and contributes `c_B`. B is credited exactly the **pre-existing** pot `c_A`. The new pending pot is `c_B`.
3. Before B claims, assets back both liabilities: B's claim `c_A` and the pending pot `c_B`. B cannot collect its own just-created contribution as part of the previous pot.
4. B claims once. Only B's claim is released; the pending pot remains available for the next qualifying buy.
5. A reverted swap, replayed execution, forged buyer, unauthorized budget operation or malicious nested call changes none of the settled liabilities, state or core fees.

The model must specify initial-buy participation, qualifying amounts, which identity receives the claim, unsupported router behavior, ordering and multiple buys in one transaction. Address uniqueness does not prove different human owners. A profitable race to become the next buyer is an economic property requiring review, not something a generic ABI checker can eliminate.

Exact USD amounts additionally require a specified quote asset or price source with rounding and stale-data policy. A native-denominated prototype must be described in native units. Funding can come from a disclosed additional contribution, an explicitly allocated creator share, or prefunded capital; none is silently chosen here.

## Uniform origin and module-independent integrations

`IProgrammableClassicLaunchV1` defines the common seven-field reader: launch ID, launch wallet, token, PoolManager, primary pool ID, hook and recipe hash. Identity schema version and engine version are independent. Native amounts, LP position IDs, module config and other engine-specific details stay in versioned detail records.

The existing `ClassicModuleLaunched` event and `getLaunch` wire encoding remain intact. A reader binds their successful canonical receipt to the common identity at the same block. Chain ID and approved source address remain part of the evidence. Token identity is `(chainId, tokenAddress)`; launch identity is `(chainId, sourceAddress, launchId)`.

A contract copying the reader or reporting version 1 is not an official launch. The consumer must authenticate the released source address/runtime, factory relationship, transaction and finality. Common origin can be recognized even when a third party does not yet interpret a new module; it does not establish supported trade routing, safety or automatic listing.

All current supported module combinations use the same launcher and token factory. Future approved engine sources can implement the same common reader and preserve their source-specific details. This is not a mutable pointer that can replace an existing launch's engine. The actual token runtime need not be byte-identical across tokens: constructor immutables already vary. Provenance is bound to verified creation and launch records.

Custom launches retain their own original stamp/source proof. A shared offchain product envelope may label both categories as Programmable while preserving their category and original source. This specification does not change the Custom path.

## Contributor integration acceptance

A new contributor package supplies source/build/dependency bindings, immutable revision, wallet ownership, config schema, declared lifecycle needs, rights, budget/funding, dependency/conflict constraints and tests. Authenticated public intake and isolated review workers remain to be implemented.

Before describing the foundation as open and stable, freeze a candidate core/interface revision and give an independent contributor only the published standard, tooling and constraints. That contributor must build an unforeseen stateful behavior using existing execution rights, compose it with an existing package and take it through intake, configuration, review and execution without changing the protected core, existing engine, token, common identity schema or bespoke product infrastructure. Preselected reference examples alone do not satisfy this test. The proof covers the demonstrated extension, not every future program.

A second acceptance case must contribute a new market engine or protected adapter through the documented package path. This case may add a new immutable implementation and a source release binding; it must preserve the common origin, agreed fee enforcement and already launched recipes. Its runtime permissions and accounting are separately proved. Novelty is not a reason to divert the contribution into a separately built launchpad or silently mutate the old kernel. If a prototype requires a new business-name branch in the core for either case, revise the standard before freezing it.

The acceptance demonstration must add the next-buyer behavior through the same package mechanism as another stateful module while leaving core source and common identity schema unchanged. It must also construct both native-quoted and ERC-20-quoted primary pools through the common market-building contract; a stock symbol is configuration and verified asset identity, not a new business-feature branch in the kernel. The builder derives normal controls from config metadata; the collector records the module commitment without importing contributor code. Novel complex UI can be isolated separately, never executed as privileged code inside the product.

An ABI-conformant module can still be unsafe or economically incompatible. Review binds an exact revision and admissible parameter/composition envelope. Routine new modules using supported primitives should need validation, review and catalogue activation rather than bespoke infrastructure coding. Review time is a property of the contribution's risk and evidence; the platform must not promise instantaneous safety approval.

Technical sources: the pinned V4 core and current Classic source in this checkout; [Uniswap Hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks). The next-buyer model and architecture above are design requirements, not a deployed reference implementation.
