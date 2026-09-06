# Classic Modules V1 contributor tools

The separate [open package candidate v0.1](OPEN-PACKAGES.md) adds a local source/configuration preview through `./open` and three `*-open-*` CLI commands. It does not change the V1 engine or its ABI and never produces a launchable or approved plan.

This local package validates module review requests, builds exact launch recipes and maintains an immutable local review queue. It does not sign, deploy, contact an API, execute contributed source code or grant onchain approval. The package is private and has not been published to npm.

The catalog can contain thousands of versions. A launch selects at most eight distinct module families. V1 supports one creator fee policy and compatible quote-limit modules; new effect kinds require a new engine version.

## Try the complete local workflow

Use Node 24.14 or a later Node 24 release. From this package directory, install the pinned dependencies and run the tests:

```sh
npm ci --ignore-scripts
npm test
node bin/programmable-classic-modules.mjs --help
```

When working in the full repository, its existing root dependencies also satisfy this package. The following examples are run from `packages/classic-modules`:

```sh
node bin/programmable-classic-modules.mjs validate-module --manifest examples/falling-creator-fee/manifest.json
node bin/programmable-classic-modules.mjs validate-recipe --recipe examples/offline-fixture-recipe.json --catalogue examples/offline-fixture-catalogue.json
node bin/programmable-classic-modules.mjs pack --manifest examples/falling-creator-fee/manifest.json --out local-module-pack.json
node bin/programmable-classic-modules.mjs submit-local --manifest examples/falling-creator-fee/manifest.json --queue local-review-queue
node bin/programmable-classic-modules.mjs list-local --queue local-review-queue
```

`submit-local` returns an `id`. Use that exact value in the next commands:

```sh
node bin/programmable-classic-modules.mjs status-local --queue local-review-queue --id <returned-id>
node bin/programmable-classic-modules.mjs review-local --queue local-review-queue --id <returned-id> --reviewer <operator-address> --decision changes_requested --note 'Add the worst-case gas and combination tests.'
node bin/programmable-classic-modules.mjs review-local --queue local-review-queue --id <returned-id> --reviewer <operator-address> --decision accepted --note 'Local review complete; deployment and independent release evidence remain required.'
```

The angle-bracket values above are placeholders, not literal shell arguments. `accepted` records a local review decision. The manifest remains `reviewStatus: "requested"`, and every local response still reports `onchainApproved: false`. Reviewer addresses are recorded operator assertions; this local tool does not prove wallet ownership. Protect the queue with ordinary operator filesystem access. A public service needs authenticated authors/reviewers, durable storage, rate limits and signed ownership challenges.

The example catalog, addresses and runtime code hashes are **synthetic offline fixtures**, even though its test entries say `approved`. Never load this fixture catalog into a public API or release. The source artifacts are real compiler inputs for the reference interfaces and modules, pinned to their stated repository commit. A successful hash check is not compilation, security review or runtime verification. The current fixture sources and interface copies are pinned to local integration commit `8530f033a7787eba2705618638e424642446bb59`; they include the corrected per-swap quote-limit description. Public contributor distribution requires publishing the matching immutable source revision with the package.

## Create a module

Implement the interface in `contracts/IClassicModuleV1.sol`. Its wire structs are in `contracts/ClassicModuleTypes.sol`. The canonical implementations live in the repository's `contracts/src/classic-modules` directory. The two source artifacts under `examples` contain complete Solidity standard JSON input and demonstrate the same interface.

For an editable Foundry project, from the repository root:

```sh
mkdir -p work/my-classic-module/src/modules
cp packages/classic-modules/contracts/*.sol work/my-classic-module/src/
cp contracts/src/classic-modules/modules/QuoteTradeLimitV1.sol work/my-classic-module/src/modules/
forge build --root work/my-classic-module --use 0.8.26 --evm-version cancun --use-literal-content --build-info
```

Rename the reference contract and implement your behavior and tests. Use an isolated build environment for contributed code and pin all compiler settings, source files and dependencies. The validator never invokes this build command. Prepare a complete source artifact with literal source content and exact settings; record its exact-byte SHA-256 in the manifest. Record the actual deployed runtime bytecode's **Keccak-256** as `runtimeCodeHash`, not SHA-256 or the creation bytecode hash. Deployment and signed family registration are separate wallet operations.

| Interface method | Required behavior |
| --- | --- |
| `moduleKind()` | Return `1` for a creator fee policy, or `2` for a quote trade limit. |
| `validateConfig(config, baseBuyFeeBps, baseSellFeeBps)` | Validate the entire immutable configuration and fee context. Return false for unsupported bytes or values. |
| `evaluate(context, config)` | Return only your kind's typed effect. Fee policies leave limits zero; limit modules leave fees zero. |

Every call is read-only with a 100,000 gas budget. An individual configuration has at most 256 bytes. Modules receive no token approvals, custody, `delegatecall` or permission to alter the mandatory 20 bps. Read-only execution alone does not prove immutability: mutable dependencies, proxies, hidden privileges and unbounded behavior fail review. The hook validates the actual execution result; local schema validation cannot replace it.

The native-quote limits apply **per swap**. Multiple swaps in one transaction, multiple transactions or multiple wallets can exceed them in aggregate. They are not guaranteed anti-sniping or anti-Sybil protection. Zero means unbounded for that direction; the reference `QuoteTradeLimitV1` requires at least one positive configured limit. Other reviewed limit modules may intentionally expire to unbounded effects.

## Prepare the review request

`schemas/module-manifest-v1.json` is strict. Unknown properties and a contributor-supplied `approved` status are rejected. The schema's HTTPS identifier is a namespace, not a claim that a public endpoint exists.

- `author` is the family owner account. `rewardWallet` is the requested initial payout address; both must be nonzero.
- `familySalt` is a stable author-selected bytes32 salt. `familyId = keccak256(abi.encode(author, familySalt))` matches `registerFamily` in the registry. Another account cannot register your family.
- `version` is a positive uint32. `versionId = keccak256(abi.encode(familyId, version))`.
- `implementation`, `runtimeCodeHash` and `chainId` bind an exact deployment. Each supported chain needs its own verified binding.
- `source.repository` and the full 40-character `source.commit` identify an immutable source revision. `artifactPath` is relative to the manifest, and `artifactSha256` hashes its exact bytes. The CLI checks the artifact bytes; it does not fetch the commit or verify source equivalence.
- `configuration.schemaUri` is a local path relative to the manifest. `schemaSha256` hashes its **canonical JSON**, using `configurationSchemaDigest`, so harmless file whitespace does not change the schema commitment.
- `configuration.fields` specifies the ordered ABI encoding. The `static-abi-v1` profile supports up to eight static values: uint8/16/32/64/128/256, bool, address or bytes32. This allows 256 configuration bytes. Dynamic ABI fields and new effect types require a later standard.
- `reviewStatus` is always `requested`. The separate trusted catalog owns approval state.

Use a closed, flat JSON Schema object with every ABI field required. Allowed primitive types are integer, string and boolean, with bounded ranges, string lengths or enums. Strings must have `maxLength <= 160`; enums have at most 32 values. JSON numbers must be safe integers. Represent large unsigned values as decimal strings. References, arbitrary regular expressions, nested data and custom executable validation are intentionally unsupported.

Use `falling-creator-fee-v1` for the exact reference `(uint256 buyEnd, uint256 sellEnd, uint256 duration)` encoding. Duration is 60 seconds through 30 days; final fees may not exceed the corresponding base fee, and at least one direction must decrease. Use `quote-trade-limit-v1` for `(uint256 buyLimit, uint256 sellLimit)`, with each value at most `2^127 - 1` and at least one positive value. The reference profiles also run these contract-specific parameter checks locally.

`manifestDigest(manifest)` is Keccak-256 of the UTF-8 canonical JSON: sorted object keys, no whitespace, array order preserved, integer values only. Version IDs and manifest hashes are different: changing a pending revision creates a new manifest digest; changing an already approved implementation requires a new version number.

## Build a recipe

```js
import {
  validateRecipe, encodeFallingCreatorFeeConfig, feeDisclosure,
} from './packages/classic-modules/src/index.mjs';

const config = encodeFallingCreatorFeeConfig({ buyEnd: 0, sellEnd: 100, duration: 3600 });
const result = validateRecipe(recipe, trustedCatalogue);
if (!result.ok) {
  // Show the structured error code/message next to the selected module.
} else {
  // result.snapshots and result.recipeHash bind the exact reviewed implementations.
}
feeDisclosure(0, 0); // buyHookFeeBps and sellHookFeeBps are both 20; pool protocol fee is unknown.
```

Every selection supplies `versionId`, raw ABI `config` and displayed `parameters`. The validator proves that the two configuration representations match. Selections must be sorted by ascending family ID, with no family repeated, at most eight selected families and at most one fee policy. The catalog size does not increase the number of executed modules.

**Only the application operator supplies `trustedCatalogue`.** Load it from a verified deployment/review source that binds the intended chain and registry. Never accept a catalog or approval fields supplied by the launching user or a contributor package. The local library verifies selected manifest/schema commitments but does not prove catalog authority, current onchain approval, runtime codehash, release readiness or current payout-wallet state. Check those from the canonical release and registry before constructing the wallet transaction.

The catalog shape is `{ schemaVersion: "1.0", chainId, registry, entries }`. Each entry is `{ manifest, manifestHash, status, configSchema }`; only `status: "approved"` permits new selections. Suspended, pending, rejected and unknown versions fail closed. Suspension affects new launches; existing onchain recipes retain their immutable snapshots.

The exact recipe hash is:

```text
itemHash = keccak256(abi.encode(
  bytes32 versionId, bytes32 familyId, address implementation,
  bytes32 codeHash, uint8 kind, bytes32 keccak256(config)
))
recipeHash = keccak256(abi.encode(
  bytes32 keccak256("programmable.classic.recipe.v1"), uint256 chainId,
  address hook, address registry, uint16 baseBuyFeeBps,
  uint16 baseSellFeeBps, bytes32[] itemHashes
))
```

`test/recipe-hash-vector-v1.json` supplies an independent cross-stack fixture for Solidity integration. `hashRecipeSnapshot` is a low-level primitive; use `validateRecipe` for untrusted inputs.

## Rewards and review boundaries

The fixed protocol fee is 20 bps (0.20%): 10 bps Programmable, 10 bps module authors. Selected creator fees are additional; base fees range from 0 to 1000 bps in 100 bps steps. One selected family earns one equal author slot. Two selected families from the same author earn two slots. Five families split a $1,000 author pool into $200 each. Dependencies and duplicate family versions do not create extra slots.

These figures describe the **hook's fees**, not every trading cost. The pool LP fee is zero, but Uniswap's PoolManager protocol controller may independently change its directional protocol fee. Unknown protocol fees stay `null` in `feeDisclosure`; zero must come from a fresh read. Supply `{ buyPoolProtocolFeePips, sellPoolProtocolFeePips }` as the optional third argument using the hook's current `feeComponents`/canonical pool state. Bps and pool pips apply to different bases; do not add the numbers or advertise a combined fee from this helper. Quote the actual route and bind its minimum output/deadline for combined impact.

`splitAuthorPool` reports integer division and the explicit remainder; it is a display helper, not the swap ledger. The contract handles cumulative accounting and claims. The zero-module destination is a bound deployment policy and is not guessed by this SDK.

The family owner may rotate its future payout wallet in the registry. Existing claimable fees remain assigned to the wallet credited when the swap occurred. A manifest's wallet is a review snapshot, not a current payout oracle. Neither catalog reviewers nor local queue decisions change economic weights or existing claims.

Local queue storage uses immutable content-addressed directories, bounded reads, no symlinks/traversal, atomic exclusive writes and append-only ordered review records. Repeating the same submission is idempotent. A changed source/schema binding creates a new request. Review records include the immutable package digest. A crash can leave a `review.lock`; the local operator must inspect the queue and confirm that no reviewer process remains before removing that exact lock. This CLI is a single-operator local reference, not a public multi-tenant intake server.

See `docs/architecture/classic-modules-contributing-v1.md` in the repository for the review requirements and API boundary.

## Creator payouts and administrative CTO changes

`buildCreatorSplit([{ wallet, shareBps }])` prepares an immutable native-fee splitter for 1–1,000 ordinary wallet addresses. It sorts and validates the complete allocation, requires positive basis-point shares totaling 10,000, and returns compact constructor bytes, the root, and individual claim proofs. This is a payout list, not a list of executed hook modules.

```sh
node bin/programmable-classic-modules.mjs prepare-creator-split --recipients recipients.json --out creator-split.json
```

The input is a JSON array, for example `[{"wallet":"0x1111111111111111111111111111111111111111","shareBps":2000},{"wallet":"0x2222222222222222222222222222222222222222","shareBps":8000}]`. The output is a local unsigned preparation. Deployment uses the exact compiled `ClassicCreatorFeeSplitterFactoryV1` release; no address or runtime hash is inferred from these examples. Keep the allocation/proofs available; they can be reconstructed from the full onchain `AllocationConfigured` event.

The splitter can receive one existing Creator fee slot (or all slots). Its internal shares are immutable. For a CTO, `encodeCreatorTakeover({ ledger, poolId, newWallets, expectedAdminRevision, deadline })` encodes the administrator's call to `replaceCreatorWallets`. Read `creatorRecipients(poolId)` and the bound administrator addresses from the intended ledger, verify the target chain/source, and review all new recipients before the wallet signs. Current slot weights are unchanged; repeated destination wallets consolidate them. The platform `rewardAdmin` or `treasury` must send this transaction. A normal Creator can only rotate their own slot with `changeCreatorWallet`.

Admin revisions change only on administrative batches. Creator self-rotation cannot veto an administrative CTO. Reaffirming the same recipients consumes the current admin revision and cancels older pending revision-bound decisions. A deadline limits when an unsigned/prepared request may be executed.

Past ledger credits remain assigned to the old wallet or old splitter. Anyone can call `ledger.claim(splitterAddress)` to fund that splitter, then `splitter.claim(index, wallet, shareBps, proof)` pays the canonical recipient. Only the beneficiary can redirect their own withdrawal with `claimTo`. The splitter has no root setter, owner, fee setter, or sweep. Changing the destination of future fees to a new splitter allows a new team/allocation without rewriting the old team's claim rights.

This does not change Creator fee rates, the fixed 20 bps or module-author shares. A coin with zero Creator fees still earns zero Creator fees after CTO. The administrative dashboard, application workflow and public proof-serving endpoint remain future integration. See `docs/architecture/classic-creator-cto-v1.md`.
