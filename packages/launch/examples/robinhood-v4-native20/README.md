# Robinhood native20 buyer-funded example

This example builds a real ETH/token Uniswap v4 market on Robinhood Chain 4663 with **zero ETH supplied as starting liquidity**. It supplies fixed token inventory to a concentrated-liquidity position. The launch wallet funds the first real ETH buy in the same atomic launch transaction, so a successful launch already has an executed trade and real ETH reserves. Deployment and later transactions still require separate ETH for gas.

It is a bounded reference implementation for the new native20 fee profile. It is not an arbitrary custom-accounting bonding curve, an audit, a promise of liquidity value, or evidence that this example is deployed. Remote submission requires an activated successor API/profile and its exact released CLI. Building this example never signs or broadcasts a transaction.

## Exact launch shape

- Fixed supply: 1,000,000,000 tokens with 18 decimals, using the user-confirmed name and ticker. The constructor sets those strings once and issues the entire supply to the initializer. There is no metadata setter, owner, mint-after-deployment, burn, transfer-tax or upgrade method.
- Pool: native ETH as currency0 and the token as currency1, LP fee 0, tick spacing 60.
- Initial position: ticks **160020–200040**, starting exactly at the upper price. The initial square-root price is **1747735933952748037356115466503453** in Q96 units.
- The initializer supplies token inventory only. It owns the exact initial position permanently and exposes no withdrawal, fee collection, approval, operator, recovery or arbitrary execution method. Token rounding dust left there is also permanently inaccessible.
- At the upper price the position is initially out of the active range; its stored position liquidity and token inventory are positive. The mandatory first ETH-input buy crosses into the range before the launch succeeds. Reading only active liquidity before that buy would incorrectly classify the token inventory as an empty pool.
- Subsequent sells draw from ETH actually put into the position through trading. There are no invented or borrowed ETH reserves. This is a finite concentrated-liquidity price range, not a separate fundraising contract or an automatic pool migration.

The initial position's principal cannot be pulled by the creator. This statement concerns that position; it does not redefine withdrawal rights for unrelated positions other users later create in the same pool. It does not guarantee a price, depth, return or continuous market demand.

## Platform fee

The exact canonical `RobinhoodNativeFeeHookV1` and `RobinhoodNativeFeeVaultV1` sources are included under `project/src/robinhood-fee-v1/`. They are copied verbatim from the reviewed source candidate, not rewritten for this example.

Every completed supported swap through this exact PoolKey funds a separate **20 BPS / 0.2% native-ETH platform obligation** to Treasury **`0xD88539d3c4C460136a733A3Fd60cf6BF269079da`**. This example selects 0% creator fees and no optional module. Alternative routers entering the same pool execute the same fee hook.

The initializer also accepts the canonical kernel's nonzero, immutable directional creator fees. Buy and sell rates may differ; each is added to the fixed platform allocation and disclosed before launch. These fees do not grant the creator access to the permanently held initial position. The optional module remains disabled for this reference initializer, and all other exact pool and source bindings remain required.

The new profile defines its own gross-native volume: on buys it includes the hook fee; on sells it is the gross ETH proceeds before that fee. Platform fees round up per trade by less than one wei. The `NativeFeesAccrued` event supplies this exact volume base; the core Swap event's post-hook input is different on buys. A complete fee-only dust execution is rejected.

Fees accrue as native ERC-6909 claims in PoolManager, backed by each swap's settlement. Anyone may pay the gas for `feeVault.claimPlatform()`, but the ETH transfer always goes to Treasury. Accrual and actual claimed wallet proceeds are distinct. The vault cannot withdraw the initial liquidity position or transfer funds to a caller-selected address.

ETH-specified partial fills revert atomically. Custom return deltas, NoOp settlement and stateful modules are outside this example's supported profile. More general mechanisms require a separately verified accounting adapter; editing the fee source or merely retaining a fee getter does not preserve the canonical guarantee.

## Acyclic graph and initialization

The graph is deliberately ordered as follows:

1. Deploy `RobinhoodNative20Initializer(manager, graphFactory)` with no target references.
2. Deploy `RobinhoodNative20Token(initializer, name, symbol)` and issue the fixed inventory to that address.
3. Deploy the exact fee hook with the token and initializer references; the hook constructs its deterministic fee vault as its first CREATE child.
4. After every target exists, the graph factory calls `initializer.initialize(token, hook, launchWallet, minimumTokensOut)` with the exact initial-buy ETH allocation in the initialization phase.

The current graph factory deploys all targets before running deferred initializer calls. This avoids a CREATE2 cycle between the hook's immutable initializer and an initializer constructor containing the hook address.

Initialization is payable, authenticated to the exact Robinhood graph factory and usable once. Its PoolManager unlock callback is also authenticated, hash-bound and usable once. It first adds token-side liquidity with no native seed debt, then spends the exact supplied ETH on a native-input buy through the canonical fee kernel. The output must be positive and meet the explicitly bound token minimum, and is transferred to the launch wallet. Missing funds, failed settlement, partial execution or insufficient output revert the entire initialization, including the pool seed and fees. The callback cannot be reused to remove liquidity.

The kernel's vault is a deterministic child at the kernel's CREATE nonce 1, not an additional graph root. Successor admission and post-launch evidence must bind its address, source, runtime and immutables explicitly.

## Build and funding declarations

The successor builder resolves live chain capabilities and prepares a deterministic pack using exact Solidity 0.8.26 compiler settings and dependency sources. Keep the canonical fee compilation unit unchanged. Compile the example token and initializer together so the initializer's embedded exact-token runtime check matches the deployed token.

The config declares:

- Funding model: buyer-funded token inventory, no native seed principal, plus a mandatory first buy funded by the launch wallet.
- Native transaction value: the exact initial-buy allocation, counted once. Gas is additional.
- Liquidity model: `project-provided-liquidity` / `liquidity-provided-by-launch`, target `initializer`.
- A separately disclosed, positive gas budget paid by the launch wallet. This recipe provides no gas sponsorship.

The server requires a first buy worth at least USD 1 using its verified native ETH/USD reference at permit authorization. It rounds the required wei upward; the agent cannot choose the exchange rate. This is a reference valuation at authorization, not a guarantee of the dollar value when the transaction executes. The first swap is evidence of executed trading, not a promise of third-party indexing.

Before building a real launch, the agent must obtain the selected chain, funding model, gas budget, project image, description, name, ticker and social links. The builder must pass the exact confirmed `projectMetadata.token.name` and `projectMetadata.token.symbol` into the token constructor. Names are nonempty and at most 64 UTF-8 bytes; tickers are nonempty and at most 16 UTF-8 bytes. Existing canonical-text rules still apply, including no surrounding whitespace or unsafe controls and no whitespace in the ticker. Admission binds the constructor arguments to that reviewed metadata. Choosing different valid strings does not require replacing the token source or its reviewed runtime. A changed token or initializer implementation requires new source-bound admission.

### Run the public builder

Use the verified CLI 4.1 release package and its bundled `project/` directory. Install the project's exact compiler dependency with `npm ci`. When copying the project outside that package, set `PROGRAMMABLE_LAUNCH_MODULE_PATH` to the extracted CLI's absolute `src/index.mjs` path.

Create `native20-input.json` after reviewing these fields with the user:

```json
{
  "launchWallet": "<checksummed Robinhood wallet>",
  "nonce": "<fresh nonzero 32-byte lowercase hex>",
  "publicOrigin": { "url": "<HTTPS source repository>", "revision": "<exact 40-character commit>" },
  "checkedAt": "<current ISO UTC timestamp with milliseconds>",
  "minimumTokensOut": "<user-reviewed positive raw token minimum>",
  "projectMetadata": {
    "schemaVersion": "programmable.project-metadata-input.v1",
    "token": { "name": "<user-confirmed token name>", "symbol": "<user ticker>" },
    "presentation": {
      "description": "<user-reviewed coin description>",
      "image": { "sourcePath": "assets/project.png", "uri": "<public HTTPS image URL>" },
      "links": [{ "kind": "website", "uri": "<user's website>" }, { "kind": "x", "uri": "<user's X profile>" }]
    }
  },
  "fundingPlan": {
    "schemaVersion": "programmable.robinhood-funding-plan.v1",
    "capitalSource": "buyer-funded",
    "pricingModel": "concentrated-liquidity",
    "nativeAllocations": { "initialLiquidityWei": "0", "initialBuyWei": "<user-approved positive first-buy wei>", "reserveWei": "0", "otherLaunchValueWei": "0" },
    "maxLaunchValueWei": "<user-approved cap covering the first buy>",
    "maxGasCostWei": "<user-reviewed positive wei budget>",
    "launchMode": "fund-and-launch"
  }
}
```

The placeholders are deliberately invalid until the agent obtains the user's values. The image must exist at the local path and pass the exact image decoder. Use `launchMode: "build-only"` for a local pack/preflight; its gas budget may be `"0"`. A build-only request cannot be submitted for launch. Changing the funding plan requires repacking because the plan is included in the launch-intent hash.

```sh
npm run build -- --input native20-input.json
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json
```

The unauthenticated builder first fetches the server's USD 1 native-ETH quote, current 4663 capabilities and a finalized checkpoint, requires the complete successor profile tuple, and refuses API keys. It compares the requested first buy to that server reference and stops if it is too small; it never raises the amount or budgets automatically. The server independently refreshes the quote before authorizing a permit. It emits two complete compiler inputs, artifacts, build evidence and the config. The canonical fee unit stays unchanged; the token and initializer compile together. A second deterministic pack pass materializes the first-CREATE vault address without changing the hook deployment address. Local reproduction does not replace backend admission, live balance/gas checks, wallet confirmation or finalized evidence.

## Local verification and limits

The dedicated tests also reject a zero first buy, a zero token minimum, a zero recipient and an unfillable minimum; failed first buys leave no initialized pool, seed or accrued fees.

The dedicated tests execute the pinned real v4-core PoolManager locally, including its constructor at the canonical address. They verify a token-only initial position, zero ETH seeding, buy/sell execution and Treasury claims, including separate nonzero directional creator fees with unchanged platform allocation and position liquidity, plus unauthorized/repeated initialization, forged callbacks and unavailable withdrawal/approval routes.

The tests impersonate the canonical graph factory locally. They are not a live fork, a signed production launch, finalized deployment evidence, source-verification evidence or proof that a third-party terminal can route this pool. Those release stages remain separate.
