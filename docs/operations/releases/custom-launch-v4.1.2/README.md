# CLI 4.1.2 response decoding release

CLI `4.1.2` bounds API response bodies and rejects invalid UTF-8, duplicate JSON keys and excessive nesting before
processing a response or deciding whether to retry. It includes the public coverage command from CLI `4.1.1`.
The API profile remains `4.1.0`, revision `2`. This procedure prepares a separate immutable
`programmable-launch-v4.1.2` release; committed source and local checks do not establish publication.

The client allows 4 MiB for control responses (capabilities, preflight and permit reissue), 64 MiB for individual
launch resource responses, and 1 MiB for HTTP error responses, with JSON nesting limited to 128 levels. It counts
actual streamed body bytes; `Content-Length` is only an early rejection check. Malformed or oversized responses return a terminal
`API_RESPONSE_*` error even on HTTP 429 or 503. Valid response retries retain the existing rules and exact request
body/idempotency key.

## Binding and source checks

`cli-release-binding.json` binds the exact package, lockfile, constants, CLI entry points, API client, response
decoder, strict JSON and UTF-8 readers, coverage reader and coverage machine contracts. It references the frozen
`custom-launch-v4.1/cli-release-binding.json` by path, schema and digest. The existing `4.1.1` client binding,
helper, schema and runbook retain their exact bytes from commit `20355da476f126f07e106a4821b565df64475665`.
Earlier release identities, artifacts and API evidence are not rewritten. The new source record has no
`releaseReady` flag or production approval claim.

After the implementation is frozen, regenerate only the new client record and review its diff:

```sh
node scripts/programmable-launch-v412-release-binding.mjs create-client-binding --repository-root . \
  > docs/operations/releases/custom-launch-v4.1.2/cli-release-binding.json
node scripts/programmable-launch-v412-release-binding.mjs audit-source --repository-root .
```

`audit-source` verifies parity and reports `productionEvidenceVerified: false`. `audit` also invokes the unchanged
API binding auditor. `verify-release-ready` additionally requires its original authenticated production proof and
backend authorization. Those gates require the exact protected production checkout and valid API evidence;
do not rewrite signed evidence or remove blockers to publish the client.

Run focused checks with Node `24.14.0` and npm `11.16.0`:

```sh
npm --prefix packages/launch test
node --test scripts/test/programmable-launch-v412-release-binding.test.mjs \
  scripts/test/programmable-launch-v411-release-binding.test.mjs \
  scripts/test/programmable-launch-v41-release-binding.test.mjs \
  scripts/test/programmable-launch-release-assets.test.mjs \
  scripts/test/programmable-launch-release-workflow.test.mjs
npm --prefix packages/launch run pack:dry-run
```

The historical `4.1.1` tests materialize a local, compressed JSON data snapshot of 14 exact Git blobs from the frozen
commit. Its SHA-256 is `65dd45167e213906d7a5ee7274f7c3ae3262922685e7284d0a4dff2ffb7d9295`; compressed input is limited
to 256 KiB and decompressed JSON to 1 MiB. Tests check every file digest against the snapshot and the original client
binding, and compare the historical release record, helper, schema and runbook bytes. Snapshot code is never executed.
Shallow, squashed or sparse checkouts do not need historical Git objects or a network fallback for these tests.
The `4.1.2` tests bind all response-decoding source files and reject source drift, identity substitution and forged
approval fields. Source-only tests never substitute for authenticated release authority.

## Protected client publication

1. Merge the reviewed client commit to `production`. Obtain its exact commit/tree, successful production `Verify`
   proof and attestation. The release job must check out the current protected production tip and matching workflow
   revision. The API's existing deployment, finality, source and backend evidence remains mandatory.
2. Follow the [owner preflight procedure](../../programmable-launch-cli-release.md#one-time-repository-controls)
   from that clean production checkout. The owner-authenticated helper signs locally against the existing trust
   root. Copy only its public `recordBase64` and `signatureBase64` fields into the existing protected `production`
   environment variables. No private key or owner API token enters Actions.
3. With explicit publication authorization, dispatch a new first attempt as `hazarxyz`. The signed production SHA
   must still match, and its observation must be within ten minutes both at job start and before publication:

```sh
gh workflow run release-programmable-launch.yml \
  --repo programmablehq/PROGRAMMABLE --ref production -f version=4.1.2
```

The exact `4.1.2` branch selects its new client binding and retains the original v41 clean-room tests, signed backend
evidence and fresh `finalize-robinhood-custom-launch-v41-deployment.mjs apply` provider, Sourcify and backend readback
before publication. The finalizer must report ready public authorization/writes, no live-artifact mutation and the
matching Phase B digest. A client patch does not bypass these checks.

The workflow creates the exact new tag at the verified production commit, then the immutable GitHub Release.
Do not pre-create a tag, replace an asset, reuse a failed identity or rerun an older job. Investigate partial
publication before preparing a new reviewed version; immutable identities cannot be repaired by replacement.

## Independent downloaded-asset verification

After publication, record the release URL, exact tag target, immutable state and all four assets:

- `programmable-launch-4.1.2.tgz`
- `programmable-launch-4.1.2.tgz.sha256`
- `programmable-launch-4.1.2.cdx.json`
- `programmable-launch-4.1.2.release.json`

From the exact protected production checkout, with its authenticated proof and unchanged API backend authorization
available through `PROGRAMMABLE_PRODUCTION_VERIFY_PROOF` and `PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION`:

```sh
client_release_dir="$(mktemp -d)"
gh release verify programmable-launch-v4.1.2 --repo programmablehq/PROGRAMMABLE
gh release download programmable-launch-v4.1.2 --repo programmablehq/PROGRAMMABLE --dir "$client_release_dir"
for client_asset in "$client_release_dir"/*; do
  gh release verify-asset programmable-launch-v4.1.2 "$client_asset" --repo programmablehq/PROGRAMMABLE
done
node scripts/programmable-launch-release-assets.mjs verify \
  --repository-root . --output-dir "$client_release_dir" \
  --source-ref refs/heads/production --expected-version 4.1.2
```

The verifier requires the exact package identity, current source commit/tree, toolchain, new client binding digest,
tarball/checksum/SBOM/manifest bytes and unchanged API release gates. The workflow also downloads and verifies the
published assets. Install the independently verified tarball in a fresh temporary prefix, require
`programmable-launch --version` to print `4.1.2`, and check the existing launch help/default behavior and the public
unauthenticated coverage read. Record publication and live readback separately. Authenticated launch preparation
still requires the public API gates; wallet review, signing and broadcast remain separate owner actions.
