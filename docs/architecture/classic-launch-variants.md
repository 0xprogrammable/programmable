# Contributor launch variants: assets, markets, data and services

Status: design requirements, 5 September 2026. Source reviewed at `efe3ecfd6cac15447601b46707589eaa8d5a1fc1`. This document does not implement a stock-quoted Classic Modules launch or activate a deployment.

## Product purpose

Programmable is intended to be shared launch infrastructure on which developers distribute reusable launch ideas. Classic is the simple entry point. A contribution can be a single behavior or an assembled launch variant with market construction, contracts, data and service integrations. Contributors should receive attribution, distribution and the already agreed module-author revenue without rebuilding token deployment, wallet flows, fee claims, indexing and a separate launchpad.

The user still launches one canonical token with one primary bonding-curve market and one immutable recipe. Supporting contracts and external integrations belong to that launch. The common identity interface must remain independent of the chosen quote asset and module behavior.

The examples in this document are acceptance cases, not an allowed-feature taxonomy. The primary design is the [open program package and protected-core model](classic-open-module-contract-v2.md#open-program-packages-small-protected-core): contributors can supply the actual execution engine, stateful programs and their supporting components. Replacing an ETH selector with a longer list of assets alone does not satisfy that architecture. A new idea must be integrable through code and explicit interface/authority declarations, without a business-feature branch in the common core.

## Why the current trade-only model is insufficient

Current Classic Modules is native-quote-only throughout `ClassicModuleLaunchV1`, `ClassicModuleHookV1`, `ClassicModuleFeeLedgerV1` and `lib/classic-modules/provenance.ts`. In particular, native quote is currency0, the launched token is currency1, fees are native claims, the initial buy uses `msg.value`, and the initial tick is fixed for the native setup. Adding a stock address to the frontend does not change these constraints.

The repository separately contains `StockPairedLaunchV1/V3`, quote registries and planners, `QuoteAssetCreatorFeeHookV1` and `QuoteAssetFeeSplitVaultV1`. These provide source patterns to evaluate for reuse. They are not already integrated with Classic Modules: the quote hook, for example, declares a fixed 100 bps total fee split into 90 creator / 10 launcher, which differs from the current additional 20 bps with equal 10/10 platform/author buckets. No deployment or current availability is inferred from these files.

The source review identifies reusable quote-side mapping, mirrored tick/position construction, exact ERC-20 receipt checks, per-asset ERC-6909 redemption and a signer-free launch entrypoint. The old fixed seven/eleven-asset registries and six-slot launch setup are not the target extensibility model. The old quote vault's claim-time payout selection also cannot replace the newer ledger's separation of past entitlements from future wallet rotation. Reuse these primitives selectively; preserve the new fee/author/CTO rules and prove them per asset.

## Market construction is an extension point

A launch package must be able to declare and validate:

- The actual quote asset and its chain-specific address, asset behavior and release-bound integration policy.
- The primary pair and which sorted PoolKey currency is the launched token versus quote.
- The curve/initial-price configuration, raw token units and funding model.
- The initial acquisition path, payer, approvals, actual received amounts, limits, refunds and launch recipient.
- The implementation revisions, modules, dependencies and resulting immutable recipe.

Supported quote assets use one general construction path. Selecting another eligible stock token must not require a new kernel `kind`, token implementation, identity schema or hand-coded form. More fundamental new market mechanisms can extend reviewed engine capabilities for new launches while preserving their standard origin and all agreed protected invariants.

The asset is selected before pool creation. A later module cannot silently replace the pair of an existing pool. Currency sorting is not semantic identity: `zeroForOne` alone no longer means buy, and native currency cannot be assumed present in every pair.

## Stock-quoted launch

The user's example means a new MemeCoin / StockToken pool, with the verified stock token as the quote asset. An existing external stock-trading venue can supply the initial stock purchase; that external route is distinct from the newly created primary pool. A quote from a venue does not manufacture seed capital or guarantee deep liquidity in the new pool.

Robinhood documents its Stock Tokens as ERC-20 assets, identifies their canonical contracts, and describes both RFQ and AMM integration. Token names are insufficient identification. The overview also distinguishes tokenized exposure from ownership of the underlying issuer's shares. Pairing alone must not be presented as backing or redemption rights for the newly launched memecoin. [Robinhood Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/), [canonical contracts](https://docs.robinhood.com/chain/contracts/), [integration guide](https://docs.robinhood.com/chain/building-with-stock-tokens/).

For pricing/UI, Robinhood's documented stock tokens keep raw balances unchanged when a corporate-action multiplier changes. Its onchain feed incorporates that multiplier, while its REST underlying prices require adjustment when valuing token units. An adapter must use a consistent unit convention and must not apply the multiplier twice. This is distinct from the AMM's own reserve price. [Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/).

External token behavior and issuer-controlled dependencies are part of the integration's declared assumptions. Their presence does not give the Programmable administrator new powers over an existing coin and cannot be described as fully immutable solely because the launch recipe is fixed. Availability of an asset, usable liquidity, applicable product eligibility and a successful route must be verified for the selected integration; a registry entry alone proves none of these other properties.

## Asset-aware fees and budgets

Every fee, author claim, creator claim and module budget must bind its currency. Claims in two different assets cannot be added into the same scalar wallet balance. The agreed 20 bps and equal 10/10 split apply to a precisely specified executed quote basis. Rounding, both quote-currency orderings and all buy/sell exactness quadrants need their own proof under the common engine.

The proposed default is accrual and claims in the pool's actual quote asset, avoiding a hidden conversion trade. This is a design recommendation, not a new confirmed payout-currency policy. Any optional conversion binds a separate route, amount, authorization, slippage and funding source. Stock units are not dollars, and gas remains separate from the initial quote payment.

Initial valuation and the approximately USD 1 minimum must use explicit asset/unit rules. The existing native minimum and initial tick cannot simply be copied to a stock or stablecoin pair.

## Data-dependent and service-dependent variants

National debt can be a data input to module behavior. A package must specify its source, units, update authority, freshness, historical binding and fallback. A reported public statistic is not itself a transferable quote asset or collateral. If the contribution instead uses a tokenized debt instrument, that instrument needs actual token identity and its own integration assumptions.

AI-credit rewards are a service integration. A module can allocate a funded entitlement; delivering usable credits requires a provider or gateway, an account-binding method, replay protection, redemption confirmation and failure/retry policy. Secrets stay outside public calldata and metadata. Contract state must distinguish reserved, requested and delivered credits. A provider promise is not completed service delivery, and unbounded third-party service cost cannot be charged to protected platform or author funds.

External fulfillment can finish after the onchain transaction. The request, confirmation and retry path must be explicit; belonging to one launch does not make an external API call atomically reversible with its swap.

These examples identify different integration needs; they are not an exhaustive list of permitted product ideas. The contribution format must accommodate new named capabilities and versioned adapters while keeping protected financial authority explicit.

## Contributor adoption and acceptance

A reusable launch variant has an author, exact revisions, searchable description, generated configuration, visible dependencies and a shareable launch preset. Presets bind module selections; wrapping existing packages does not automatically create additional paid families. Author pages and observable use/earnings make building on Programmable more attractive. Authors should be able to build with their own tooling and automate submissions without depending on the optional chat.

The technical acceptance matrix now includes native Classic, an ERC-20/stock-quoted Classic with the same base identity, a stateful funded reward, a data-dependent behavior and a service entitlement. Market construction plus stateful execution are the first source implementation priorities. Data/service examples may begin as explicitly local conformance fixtures; production availability requires real dependency and delivery evidence.

These planned examples are supplemented by the open-module standard's independent unforeseen-contribution test and the separate contributor-supplied engine/adapter test. Both must be completed before calling the public foundation proven extensible. Passing known examples must not conceal special-case code for each example in the protected core.

For the stock path, a second eligible quote asset must be selectable by the same package and configuration mechanism without core edits. The local suite must cover quote sorting, units, initial buy, buy/sell, asset-separated 10/10 author accounting, claims, immutable provenance and composition with a stateful module. An actual stock integration additionally needs the authentic deployed asset and usable route; a mock proves only interface/accounting behavior.

Bankr's public launch documentation already references stock-pair selection and using token fees to fund agent API costs. That establishes relevant product examples, not measured ecosystem adoption or a claim that Programmable already implements them. [Bankr launch documentation](https://docs.bankr.bot/token-launching/overview/).
