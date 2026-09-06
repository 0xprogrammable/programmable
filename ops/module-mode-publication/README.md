# Publish a reviewed Module Mode package

This operator is the common path for starter and community modules on the native Robinhood engine.
It accepts a package identity and reviewed artifacts; there is no dispatch by module name. Contributors
submit through the public module API with their authenticated EVM author and reward wallets. They do
not need a GitHub repository or a pull request. Publication is a separate operator responsibility.

The three commands are `manifest`, `prepare` and `export`. They never sign, send a transaction,
publish a website or change the catalogue. `export` writes a reviewable local publication only after
real Registry, contract-code, transaction and receipt checks pass on both reviewed RPC providers.

## Inputs and authority

- `--identity`: the actual immutable Module Mode release identity, including its canonical digest and
  fifteen contract pins. Obtain it from the base deployment operator; do not fill it with preview IDs.
- `--definition`: the complete native catalogue definition without `status` or `nativeBinding`.
  It includes source path/hash, schema, defaults, input units, program ABI, management manifest,
  requirements, constraints and engine profile. These are covered by the host-manifest hash.
  `programAbi` must exactly equal the tested plan and build artifact. Both declare
  `configurationCodec: "programmable.native-abi@1"`; no alphabetically ordered generic encoding
  is silently substituted for the program's reviewed argument order.
- `--submission`: the UUID returned by module submission.
- `--session-file`: an existing administrator's Privy session in a local owner-only regular file:
  `{ "walletAddress": "0x…", "accessToken": "…", "identityToken": "…" }`.
  `identityToken` is optional. Never put session tokens in commands, source control or messages.
  A contributor API key cannot approve or publish a module.
- `--output`: a new directory under an existing private `0700` parent outside the repository.
  The operator never overwrites an earlier result.

The fixed-origin website BFF `/api/admin/modules/<id>` and `/source` authenticate the current session,
bind its linked wallet and use the existing signed BFF-v2 request to the private review API. The backend
enforces its reviewer allowlist. Source and accepted decisions come from this live read on every run.
A caller-provided local `review.json`, a hash, a source upload or a passing compilation does not grant
reviewer authority. The operator checks a completed protected worker attempt, exact source/request,
package/family/reward identity, the native compiler pins, complete source input, ABI/code hashes and
the current review revision. It repeats the detail read to reject a concurrent review transition.

Worker provenance follows the existing append-only backend events. `claimed` contains the worker
identity; `completed` contains the artifact digest and has no worker identity. Completion is stored
only after the backend matches the live lease, attempt, request, plan and worker-identity hash under a
row lock. The reader requires one claim and one successful completion for the **current job attempt**,
matching its request, plan and artifact. It verifies the claim's worker digest using the backend domain
`programmable.modules.worker-identity.v1` and retains the protected-workflow pin. It rejects competing,
duplicated, expired, failed or mismatched current-attempt records, inconsistent event times, and rows
that violate the API's `attempt DESC,event` order. Older attempts may belong to other plans or workers;
they never substitute for the current pair. The closing authenticated read must return the same event
history as well as the same job and decisions.

These event and digest semantics are defined in backend commit
`55cd1e5f99503d3f2e79182eff143201db6ae34e`,
`services/custom-launch-api-v1/src/module-review/postgres-v1.ts` (`claim`, `complete`, `attempts`).
The reader does not reconstruct a lease or accept local event JSON as worker or reviewer authority.

Compiler constants in `review.ts` match backend `src/module-review/native-build-v1.ts`,
`src/verification/types-v4.ts` and `src/verification/protected-hosted-build-producer-v4.ts` from backend
commit `caff9019`. This is the native profile, not permission to introduce another compiler or mutable
dependency. Its exact build artifact remains an authenticated private-review output.

## 1. Construct the manifest for review

After the protected build reaches `built`, run:

```sh
node ops/module-mode-publication/operator.mjs manifest \
  --identity /private/operator/release-identity.json \
  --definition /private/operator/module-definition.json \
  --submission 00000000-0000-4000-8000-000000000001 \
  --session-file /private/operator/session.json \
  --output /private/operator/manifest-run
```

The paths and UUID above are placeholders. `manifest.json` is the exact input for the website review
console. The factory address is derived with CREATE2 from the canonical deployer, reviewed factory
creation bytes, package ID and release digest. There is no constructor-argument guess or factory-name
allowlist. The protected native profile supports factories with no constructor parameters. A different
runtime profile requires its own versioned build/host adapter.

The reviewer checks the entire configuration range, external dependencies, callback behavior, budgets,
management roles and composition. The review command must accept this exact artifact and manifest.
The operator neither generates that decision nor signs on behalf of the reviewer.

## 2. Prepare the onchain operations

Run the same arguments with `prepare` and a new output directory. This requires the current state
`accepted`, the last append-only decision, and `expectedReviewRevision + 1 == reviewRevision`.
The operator reads all base code pins and the Registry owner through the existing reviewed provider
commitment mechanism. Use the same protected RPC environment/custody records as the base deployment
operator; it never prints endpoints or credentials.

`unsigned-plan.json` contains decoded operations and exact targets, values and calldata:

1. Deploy the package factory through the canonical CREATE2 deployer, if its address is vacant.
2. Bind the API-authenticated author and reward wallet using `registerReviewedFamily`, if the family
   is absent. For an existing family, verify its author and current reward wallet; do not overwrite it.
3. Admit the immutable package revision with its factory/code/manifest/callback pins.

These are unsigned operation templates, not armed wallet requests. Simulate each operation immediately
before signing, check the connected wallet and chain, and inspect the actual gas quote. Do not replay a
transaction whose submission outcome is unknown. An existing revision is never overwritten or
automatically re-enabled. Factory deployment may be reused only with its actual matching transaction
and receipt. Registry mutations require the actual current Registry owner.

## 3. Verify and export

Create a private transaction file with the actual hashes:

```json
{ "factory": "0x…", "family": "0x…", "revision": "0x…" }
```

Use `family: null` only when the family already existed with the exact author and current reward wallet.
Run the same command with `export`, a new output directory, and
`--transactions /private/operator/transactions.json`.

Two independent, commitment-bound providers must agree on chain 4663, a recent common block, every
base runtime pin, canonical CREATE2 code, current Registry authority, factory code, author/reward
wallet, enabled immutable revision, exact operation calldata, successful receipts, canonical block
membership and the `RevisionApproved` event. The reader checks the snapshot again for a reorganization.
The accepted review is fetched again after the onchain checks. Changed records stop the export.

Successful output contains:

- `public/developers/modules/<packageId>/{source,manifest,review}.json`, with original source bytes and
  the exact historical accepted decision; its historical `available: false` flags remain unchanged.
- `catalog-fragment.json`, to merge deliberately into the protected canonical catalogue without
  dropping other entries.
- `publication-evidence.json`, the actual canonical inclusion/code/Registry readback.
- `export.complete.json`, written last. Without it the run is incomplete.

This readback proves canonical L2 inclusion; it does not substitute for the separate Robinhood-to-
Ethereum finality proof, base deployment/source/lifecycle gates or publication approval. The output
explicitly records these limits. The integration owner checks those release requirements, reviews the
source-publication decision, copies the immutable files and catalogue entry into a protected
`production` pull request, passes CI, deploys, and checks the public `/api/module-mode` response.
No command copies files into the live catalogue or enables a preview release automatically.

## Validation

```sh
npx vitest run tests/module-mode-publication.test.ts
npx eslint ops/module-mode-publication tests/module-mode-publication.test.ts
npx tsc --noEmit
```

The tests use explicitly synthetic source, review and RPC fixtures. They are never deployment or
approval evidence. The CLI bundles repository-owned TypeScript with the package-lock-pinned esbuild;
submitted Solidity is treated only as data and is never executed by this publication process.
