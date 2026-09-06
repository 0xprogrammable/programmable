# Programmable Launch CLI release

This runbook publishes `@programmable/launch` only as an immutable GitHub
Release from the exact reviewed `production` commit. It does not publish to the
npm registry and it never grants wallet, signer, or broadcast authority.

## One-time repository controls

The repository must have immutable releases enabled. It must also have one
active tag ruleset with no bypass actors:

- name: `Protect Programmable Launch CLI release tags`
- target: tag
- include: `refs/tags/programmable-launch-v*`
- exclude: none
- rules: block update and deletion

The workflow authenticates the complete tag ruleset with its job token. GitHub's
immutable-settings endpoint instead requires repository `Administration: read`,
which the default Actions token cannot request. No App key, PAT, or owner signing
key is entrusted to the workflow.

The public trust root is the single non-CA entry in
`.github/release-trust/programmable-launch-immutable-release-owner.allowed_signers`:

- principal: `258789013+hazarxyz@users.noreply.github.com`;
- Ed25519 fingerprint:
  `SHA256:RTXVJ3XspKUc+Qmj/daOWwU2WyT+qbRBtsJJwNpItdI`; and
- namespace: `immutable-release-preflight@programmable.xyz`.

The `namespaces=` option is part of the exact checked-in line. Wildcard principals,
certificate authorities, additional keys, or a broader namespace are not accepted.
The corresponding private key stays owner-controlled and local. The Node helper
never opens it; `/usr/bin/ssh-keygen` may use the private key path directly or a
public key whose private half is available through the owner's local `ssh-agent`.

Immediately before dispatch, the exact owner `hazarxyz` (`actor_id=258789013`)
must use an owner-authenticated local GitHub CLI session. From a clean checkout of
the exact production revision, run outside GitHub Actions:

```sh
node scripts/capture-immutable-release-owner-preflight.mjs \
  --repository programmablehq/PROGRAMMABLE \
  --repository-id 1314365508 \
  --revision EXACT_PRODUCTION_SHA \
  --environment production \
  --signing-key "$owner_controlled_ssh_signing_key" \
  > "$local_capture_file"
```

The helper refuses to run when `GITHUB_ACTIONS` is present. It validates
`gh api /user` as the exact login and numeric owner, validates the live `production` ref
as the requested SHA, and makes owner-authenticated requests to the
[immutable release setting endpoint](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository).
It retains that response's exact body bytes, SHA-256, canonical HTTP `Date`,
`X-GitHub-Request-Id`, status `200`, and the exact parsed two-key body
`{"enabled":true,"enforced_by_owner":BOOLEAN}`. Both values of
`enforced_by_owner` are accepted, but the key must be present and boolean. It then
signs the record locally and verifies the result against
the checked-in trust root before emitting the capture JSON.

The same signature also binds the complete response for tag ruleset `21679403`, including an explicit empty `bypass_actors` array. GitHub [omits this field for callers without ruleset write access](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset), including the ordinary workflow token. The workflow requires the signed owner response and compares every public protection field and the normalized `updated_at` timestamp against a fresh workflow read before building and before publication. Missing owner permissions, any bypass actor, changed protection, or changed update timestamp fails closed. Both signed endpoint observations must be fresh and within 30 seconds of each other. No owner API token is passed to Actions.

The signed record uses schema
`programmable.github-immutable-release-owner-preflight.v3`. Its UTF-8 bytes are
RFC 8785/JCS JSON followed by exactly one LF. The record has exactly these fields:

```json
{"actorId":"258789013","actorLogin":"hazarxyz","apiVersion":"2026-03-10","environment":"production","observedAt":"YYYY-MM-DDTHH:MM:SSZ","repository":"programmablehq/PROGRAMMABLE","repositoryId":"1314365508","response":{"bodyBase64":"RAW_ENDPOINT_BODY_BASE64","bodySha256":"sha256:...","date":"HTTP_DATE","enabled":true,"enforcedByOwner":false,"requestId":"X_GITHUB_REQUEST_ID","status":200},"revision":"EXACT_PRODUCTION_SHA","schemaVersion":"programmable.github-immutable-release-owner-preflight.v3","tagRuleset":{"response":{"bodyBase64":"RAW_RULESET_BODY_BASE64","bodySha256":"sha256:...","date":"HTTP_DATE","requestId":"X_GITHUB_REQUEST_ID","status":200},"url":"https://api.github.com/repos/programmablehq/PROGRAMMABLE/rulesets/21679403"},"url":"https://api.github.com/repos/programmablehq/PROGRAMMABLE/immutable-releases"}
```

Both the LF-terminated record and the complete armored OpenSSH signature are
transported as canonical padded RFC 4648 base64. The owner copies only these two
public values from the helper output into the protected `production` environment
variables:

- `PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64`; and
- `PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64`.

The workflow accepts only a first-attempt dispatch by the exact login/numeric
actor, requires the signed revision to equal the detached production SHA,
recomputes the raw body and record digests, and checks the GitHub response date
within ten minutes both at job start and immediately before release creation. A
foreign dispatch, rerun, stale or future record, noncanonical byte representation,
wrong signature namespace/principal/key, changed body, or different SHA fails
closed before publication. After publication the workflow independently requires
GitHub to report `isImmutable: true`; draft releases are not immutable. See
GitHub's [immutable release behavior](https://cli.github.com/manual/gh_release_create).

This remains an owner-signed pre-dispatch observation, not an independent endpoint
read by the workflow and not a one-time authorization token. The same signed
observation may be replayed only within its ten-minute window and only for the same
production revision and actor; it is not bound to one version or run ID. Anyone
who can administer environment variables can withhold or replace the public
transport values but cannot forge the required owner signature. Key rotation
requires an explicitly reviewed replacement of the one-line trust root and the
pinned fingerprint; never append a second key as an emergency bypass.

## Source preparation

Prepare one clean `production` candidate in which all of these values agree:

1. `packages/launch/package.json` contains the new exact version.
2. Package constants, install instructions and the expected tarball SHA-256
   identify that same CLI release. For an API release, discovery and OpenAPI
   also match it. The additive CLI `4.1.1` instead references the unchanged API
   `4.1.0` profile and discovery pins through its separate client binding below.
3. The expected tarball digest was computed with Node `24.14.0`, npm `11.16.0`
   and `npm pack --ignore-scripts` from the exact candidate package tree.
4. The package tests, machine-contract verification and dry pack pass.
5. The candidate is merged to `production` and its exact production `Verify`
   run produces a fresh, Sigstore-attested proof.

The release workflow re-runs those package gates and rejects any version that
does not exactly match its dispatch input. It does not reuse a tag or release
and it never uses `--clobber`.

## Publish

### Additive launch coverage rollout

The public coverage read is independent of the frozen launch profiles. Deploy the backend implementation of
`GET /v4/chains/4663/launch-coverage` first and verify its exact production response against
`public/schemas/custom-launch/coverage/v1.json`, including `tokenAndHookMayShareAddress: false` and
`requestAuthorized: false`. Readiness does not establish wider architecture support. Check that ordinary 4.0/4.1
capabilities, preflight, request and status contracts retain their original bytes and behavior.

Publish the separate `public/openapi/launch-coverage-v1.json`, response schema and developer guidance from the
reviewed `production` release. The source `coverage` command uses the separate CLI `4.1.1` package and immutable
`programmable-launch-v4.1.1` release, with the same exact-source, checksum and downloaded-asset verification described
here. Follow the [4.1.1 client release procedure](releases/custom-launch-v4.1.1/README.md). Do not reuse
or replace the existing 4.0.0 or 4.1.0 release tags, tarballs, checksums or discovery pins. A source-only merge does not
make the command available in those installed clients. Preserve the pinned historical API discovery, OpenAPI and
profile bytes; they retain `4.1.0`. The new client install instructions identify `4.1.1` separately, and the older
CLI commands and their existing request semantics remain compatible.

Verify the new client against the live unauthenticated report and an older deployment returning 404. The latter
must produce `LAUNCH_COVERAGE_UNAVAILABLE`, without loading or transmitting a key, inferring support or changing any
launch request. Neither this report nor its publication activates a new graph, Router or write profile.

### Dispatch the immutable release

From the Actions page, run `Release Programmable Launch CLI` on the
`production` branch with the exact version from `packages/launch/package.json`.
Use a new first-attempt dispatch immediately after setting both signed owner
preflight variables; never rerun an earlier release job.
The workflow:

1. validates the fresh owner-bound immutable-release preflight for the exact
   production SHA, then validates the same record again immediately before
   publication;
2. consumes and verifies the exact-commit production `Verify` proof;
3. installs the exact Node and npm toolchain and exact shrinkwrapped runtime
   dependency closure;
4. runs the focused public package gates;
5. builds one tarball, adjacent checksum, normalized CycloneDX SBOM and
   source/toolchain/digest manifest;
6. self-verifies every byte and creates GitHub OIDC/Sigstore provenance for all
   four assets;
7. creates the release and tag at the exact `production` commit;
8. requires the published release to report `isImmutable: true`; and
9. downloads all assets into a fresh directory, verifies the release and every
   asset attestation, then re-runs the byte-level verifier.

The automatically created release tag points to the exact GitHub-verified
source commit. It is not an annotated or independently signed tag, and must not
be described as one. Asset provenance comes from the release workflow's OIDC
attestations. GitHub documents the consumer checks in
[`gh release verify`](https://cli.github.com/manual/gh_release_verify) and
[`gh release verify-asset`](https://cli.github.com/manual/gh_release_verify-asset).

## Independent readback

After the workflow succeeds, record the exact release URL, tag target commit,
immutable state, asset names, byte sizes and SHA-256 digests. In a new temporary
directory, repeat:

```sh
gh release verify programmable-launch-vVERSION \
  --repo 0xprogrammable/PROGRAMMABLE
gh release download programmable-launch-vVERSION \
  --repo 0xprogrammable/PROGRAMMABLE \
  --dir "$temporary_release_directory"
for asset in "$temporary_release_directory"/*; do
  gh release verify-asset programmable-launch-vVERSION "$asset" \
    --repo 0xprogrammable/PROGRAMMABLE
done
node scripts/programmable-launch-release-assets.mjs verify \
  --repository-root "$exact_production_checkout" \
  --output-dir "$temporary_release_directory" \
  --source-ref refs/heads/production \
  --expected-version VERSION
```

Then checksum-install the tarball in another clean room, run `pack` and
`validate` from real exact source/build artifacts, and stop before submit,
signature, or broadcast unless the release plan separately authorizes those
steps. Keep production deployment, live API readback, release immutability and
clean-room evidence as distinct records.

If publication fails after GitHub creates a tag or draft, stop. Do not delete,
move, reuse, or overwrite release identity automatically. Inspect the remote
state and resolve it explicitly before another versioned release.
