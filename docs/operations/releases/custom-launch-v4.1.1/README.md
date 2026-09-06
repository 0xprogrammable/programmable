# CLI 4.1.1 additive client release

CLI `4.1.1` adds the public `coverage --chain-id 4663` command. The API profile remains `4.1.0`, revision `2`.
Existing launch commands, profile tuples, policy digests, Router authority and wallet gates remain unchanged.
This procedure prepares a new immutable `programmable-launch-v4.1.1` release; committed source is not publication.

## Binding and source checks

`cli-release-binding.json` binds the exact package/version/lock/constants, coverage reader and separate coverage
machine contracts. It references the frozen `custom-launch-v4.1/cli-release-binding.json` by path, schema and digest.
The historical record continues to identify package/API `4.1.0`; it is not rewritten or relabeled as `4.1.1`.
The new source record has no `releaseReady` flag or production approval claim.

After any intentional change to a bound client file, regenerate only the new client record, then review its diff:

```sh
node scripts/programmable-launch-v411-release-binding.mjs create-client-binding --repository-root . \
  > docs/operations/releases/custom-launch-v4.1.1/cli-release-binding.json
node scripts/programmable-launch-v411-release-binding.mjs audit-source --repository-root .
```

`audit-source` verifies parity and reports `productionEvidenceVerified: false`. It is available in an isolated
candidate checkout. `audit` also invokes the unchanged API binding auditor, whose source evidence requires the
current protected production checkout. `verify-release-ready` additionally invokes its original authenticated
production proof and backend authorization verifiers. A candidate checkout or inactive API record must fail those
gates; do not substitute refs, inject mock verifiers, rewrite signed evidence or remove blockers to release a client.

Required focused checks include:

```sh
npm --prefix packages/launch test
node --test scripts/test/programmable-launch-v411-release-binding.test.mjs \
  scripts/test/programmable-launch-v41-release-binding.test.mjs \
  scripts/test/programmable-launch-release-assets.test.mjs \
  scripts/test/programmable-launch-release-workflow.test.mjs
npm --prefix packages/launch run pack:dry-run
```

Use Node `24.14.0` and npm `11.16.0`. Preserve frozen 4.0.0/4.1.0 release assets, checksums, API contracts and discovery
pins. The new release manifest uses the existing asset manifest v2 shape with the new client binding schema/path;
its source commit/tree and four attested assets bind the whole package independently of the historical API identity.

## Backend first, then protected client publication

1. Deploy the backend coverage endpoint first. From the reviewed client source, run the unauthenticated read:
   `node packages/launch/bin/programmable-launch.mjs coverage --chain-id 4663`. Verify the production response's
   schema, separate readiness, `tokenAndHookMayShareAddress: false` and `requestAuthorization.requestAuthorized: false`.
   A missing endpoint must return `LAUNCH_COVERAGE_UNAVAILABLE`. Do not rotate or transmit a key for this read.
2. Merge the reviewed client commit to `production`. Obtain the exact commit/tree, successful production `Verify`
   proof and its attestation. The release job must check out the current protected production tip and matching
   workflow revision. The API's existing source/deployment/finality/backend evidence remains mandatory.
3. Follow the [owner preflight procedure](../../programmable-launch-cli-release.md#one-time-repository-controls)
   from that clean production checkout. The owner-authenticated capture helper signs locally against the existing
   trust root. Copy only its public `recordBase64` and `signatureBase64` fields to the protected `production`
   environment variables `PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64` and
   `PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64`. No private key or owner API token enters Actions.
4. Immediately dispatch a new first attempt as `hazarxyz`. The signed production SHA must still match, and the signed
   observation must remain within ten minutes both at job start and immediately before publication:

```sh
gh workflow run release-programmable-launch.yml \
  --repo programmablehq/PROGRAMMABLE --ref production -f version=4.1.1
```

The workflow's exact `4.1.1` branch selects the new client binding while retaining the existing v41 clean-room tests,
signed backend evidence and fresh `finalize-robinhood-custom-launch-v41-deployment.mjs apply` provider/Sourcify/backend
readback before mutation. The finalizer must report ready public authorization/writes, no live-artifact mutation and
the matching Phase B digest. These checks cannot be waived for an additive CLI feature.

The workflow creates the exact new tag at the verified production commit and then the immutable GitHub Release.
Do not pre-create the tag, overwrite an asset, reuse a failed identity or rerun an older job. A stale owner observation
requires a new valid capture and first-attempt dispatch. If a tag already exists after a partial failure, investigate
and prepare a new reviewed version; immutable identities cannot be repaired by replacement.

## Independent downloaded-asset verification

After the workflow succeeds, record the release URL, exact tag target, immutable state and all four assets:

- `programmable-launch-4.1.1.tgz`
- `programmable-launch-4.1.1.tgz.sha256`
- `programmable-launch-4.1.1.cdx.json`
- `programmable-launch-4.1.1.release.json`

From the exact protected production source checkout, with its authenticated proof and unchanged API backend
authorization available through the existing `PROGRAMMABLE_PRODUCTION_VERIFY_PROOF` and
`PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION` inputs:

```sh
coverage_release_dir="$(mktemp -d)"
gh release verify programmable-launch-v4.1.1 --repo programmablehq/PROGRAMMABLE
gh release download programmable-launch-v4.1.1 --repo programmablehq/PROGRAMMABLE --dir "$coverage_release_dir"
for coverage_asset in "$coverage_release_dir"/*; do
  gh release verify-asset programmable-launch-v4.1.1 "$coverage_asset" --repo programmablehq/PROGRAMMABLE
done
node scripts/programmable-launch-release-assets.mjs verify \
  --repository-root . --output-dir "$coverage_release_dir" \
  --source-ref refs/heads/production --expected-version 4.1.1
```

The byte-level verifier requires the exact package identity, current source commit/tree, toolchain, client binding
digest, tarball/checksum/SBOM/manifest bytes and unchanged API release gates. A successful source-only audit or local
pack is insufficient. The workflow also performs a fresh download and provenance verification automatically.

Install the independently verified tarball into a fresh temporary prefix and check `programmable-launch --version`
prints `4.1.1`, `coverage --chain-id 4663` reads the live unauthenticated report, and the existing launch help/default
behavior remains available. Record publication and live readback separately. Coverage never authorizes a launch,
changes the graph/Router, or proves support for same-address token/hooks, arbitrary hooks or every architecture.
