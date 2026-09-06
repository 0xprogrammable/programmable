# Open package SDK candidate v0.1

This implements the first **local source and configuration slice** of the open Classic architecture: source-package declarations, pinned local file bytes, structured configuration encoded to deterministic ABI bytes, caller-supplied role/asset/component bindings, typed preparation links and numeric constraints across the configuration.

The V1 contracts, fees, authority and launch API are unchanged. This is **not a new launch engine**. Successful plans always say `scope: configuration-preview`, `launchable: false`, `onchainApproved: false`, `runtimeVerified: false` and `authorizationVerified: false`. A modelled connection is not an executed contract call. Matching hashes do not prove authorship, review, economic safety or compatibility with V1's ABI.

## Run the complete local example

From the repository root, choose a new destination whose parent exists:

```sh
node packages/classic-modules/examples/open-packages/demo.mjs /tmp/programmable-open-example
```

The example creates an explicitly **inert fixture**, descriptor, nested recipient template, bindings, source bundle, two configuration plans for different creator wallets, and a rejected conflict. Its `example.invalid` repository and fixture revision are intentional test data. It is not a deployable module or evidence of the independent-contributor/general-engine acceptance criteria.

The destination must not exist. The example uses the real CLI and file-hash checks without executing packaged source. Inspect `plan.json`, `other-wallet-plan.json` and `conflict.json`. The symbolic creator changes between plans; the literal recipient remains the same. A minimum greater than the maximum is rejected while the edited input is preserved.

Individual commands use paths relative to an explicit root:

```sh
node packages/classic-modules/bin/programmable-classic-modules.mjs validate-open-package \
  --root /tmp/programmable-open-example --package package.json

node packages/classic-modules/bin/programmable-classic-modules.mjs pack-open-package \
  --root /tmp/programmable-open-example --package package.json --out another-source-pack.json

node packages/classic-modules/bin/programmable-classic-modules.mjs plan-open-template \
  --root /tmp/programmable-open-example --template template.json --packages packages.json \
  --bindings bindings.json --out another-plan.json
```

`packages.json` is an array of descriptor paths. Descriptor paths **and source-file paths** are relative to `--root`, not to the descriptor directory. Output parents must exist; outputs are exclusive creations. These commands do not sign, deploy, upload, fetch dependencies, execute contributor code or approve modules.

## Source identity and trust boundary

`programmable.classic.source-package.v0.1` binds name/version, claimed author/reward wallet and family salt; repository/revision and file hashes including documentation; components and versioned runtime names; configuration/constraints/typed ports; management declarations; required host capabilities; and optional inert descriptive extensions with versioned namespaces. Runtime and interface names are open namespaces, not business-feature enums. Extensions do not add executable codec or host support.

The package ID is SHA-256 of canonical JSON `{domain: format, value: descriptor}`. Family ID uses the existing author/salt derivation. Packaging checks regular-file bytes against the declared digests. It does **not** fetch Git, prove the revision contains those files, compile them, inspect imported dependencies, authenticate an author or attest runtime code. It reports `localFileHashesVerified: true` separately from `sourceRevisionVerified: false`.

Use an exclusively controlled snapshot as the input root. Existing file checks reject traversal and existing symlinks; they are not a filesystem sandbox against a hostile process concurrently renaming parent directories. Untrusted builds belong in a separate isolated workspace. The JS API consumes data; it is not a sandbox for executable JavaScript callers or Proxies. CLI input is parsed JSON.

Management reads/actions currently bind declarations, components, labels and input schemas. They do not create executable wallet operations or prove complete website integration. The later admitted action/engine implementation must verify targets, authority, funding and effects against actual code.

## Configuration codec

The entry point is `@programmable/classic-modules/open`. `compileOpenConfig(schema, values, context)` returns normalized values, one root ABI parameter, ABI values, encoded bytes and explicit reference bindings.

| Type | Behavior |
| --- | --- |
| `record` | Named fields, explicit required list, lexical encoding order, unknown fields rejected. |
| `array` | Ordered items, bounded length. |
| `uint` | Exact unsigned decimal strings or safe integers; normalized strings; bits/range/unit metadata. |
| `bool`, `string`, `bytes` | Strict Boolean or bounded UTF-8/hexadecimal data. |
| `address` | Literal EVM address; mixed-case values require a valid checksum. Zero-address meaning belongs to the admitted field semantics. |
| `account` | Explicit `{address}` or `{role}` resolved from supplied role bindings. |
| `asset` | `{asset}` reference to chain ID, address and decimals in the supplied asset map. |
| `component` | `{component}` reference to a supplied component address. |
| `variant` | A discriminator and selected record branch. |

Optional fields encode `(bool present, T value)`. Absence uses a type-level zero independently of the valid present-value range. Absent, false and present-zero stay distinct. Variants encode `(uint16 branchIndex, bytes branchData)`, using lexically sorted branch indexes and the branch record tuple. Empty records use a fixed `tuple(bool _empty)` false sentinel so they remain decodable. A schema change changes package identity and requires its matching codec.

Normalized values preserve symbolic handles; `bindings` commits their resolved addresses and asset metadata. Address calldata alone does not bind chain or decimals. Binding maps are caller assertions, not signatures, chain readback or authority proofs. Missing required references fail. There is no implicit token amount conversion.

Exported `OPEN_CONFIG_LIMITS` bounds depth, nodes, arrays, strings and encoded size. `OPEN_PLAN_LIMITS` bounds 64 instances, 128 supplied packages, 256 preparation links and aggregate JSON size. These are local data-processing limits, not measured onchain execution capacities or permanent catalogue limits. The current codec is EVM-oriented; other runtimes require corresponding codec/engine integration.

## Constraints and composition

Constraints contain a stable ID, message, two expressions and `eq`, `lt`, `lte`, `gt` or `gte`. Expression forms include:

```json
{"literal":"10000","unit":"bps"}
{"ref":{"instance":"rewards","path":["minimum"]}}
{"sum":{"instance":"rewards","path":["recipients"],"member":["share"]}}
{"add":[{"literal":"4000","unit":"bps"},{"literal":"6000","unit":"bps"}]}
```

Package constraints use `$self`; template constraints use explicit instance IDs. Numeric references require normalized unsigned integers at schema-declared numeric fields. Arithmetic uses `BigInt`; units must match exactly. A unit is nonempty, well-formed UTF-8 text of at most 128 bytes, without trimming or Unicode normalization. Empty sums derive their unit from the item schema. Missing optional/inactive variant fields fail rather than becoming zero. Expressions never execute JS or fetch schemas. Unit labels remain claims requiring semantic code review.

Every package's own constraints and the template's aggregate constraints are checked. Each input port requires exactly one source of the identical versioned interface. Preparation links form an acyclic graph with deterministic ordering; cyclic runtime behavior and callback scheduling are not inferred.

Explicit IDs distinguish shared use of one instance from separate instances of identical packages. The plan commits sorted instances, exact package IDs, normalized values, ABI bytes, resolved references, components/management, typed links, preparation order, aggregate constraints and host requirements. Reordering keys, the catalogue or instance list does not alter an otherwise identical plan. Changed bindings, config, connections or packages do.

Family candidates are deduplicated across versions/instances. Conflicting declared wallets require resolution. This does not prove independent functionality, allocate fees or replace the admitted registry's current author state. Empty templates do not select a destination for the zero-module author bucket.

Missing host capabilities remain explicit even with a valid preview. Caller-supplied host capabilities are local assertions, not website availability evidence. There is no path here from successful preview to onchain approval or launchability.

## Following work

Actual reproducible builds and admitted engine/action contracts must next enforce protected funds, authenticated actors, per-launch state, effective immutable code, permitted control transitions, runtime composition conditions and market construction. Local revalidation of edited parameters is not onchain enforcement.

Full management UI, new intake service, independent review, registry activation, collector and real deployment/claim evidence remain outstanding. So do the unexpected-contributor and new-engine demonstrations. This candidate provides executable source/configuration boundaries for those steps, without replacing them with metadata.
