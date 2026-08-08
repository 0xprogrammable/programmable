# Custom Launch detached release record V1

This directory defines the immutable release-record path required by
`CUSTOM-LAUNCH-PRODUCTION-ACTIVATION-V1.md`. It does not clear the production
freeze and it does not authorize a deployment or promotion.

## Why the record is detached

The record binds the final Website commit. Storing that record inside the same
commit would create an impossible self-reference: changing the record changes
the commit it names. Create the Website commit first, then instantiate this
template as a detached, content-addressed Command Center record. Retain the
record on the dedicated `command-center-release-records` branch at
`release-records/custom-launch-v1/release-record.json`. The production workflow
fetches an explicitly supplied commit from that branch rather than trusting its
mutable tip. The verifier prints the SHA-256 of the entire canonical record so
the retained object can be identified without mutating it.

The record has two different hashes:

- `subject.releaseSubjectSha256` binds the exact Website commit, reviewed diff,
  approval-service package artifact, its two packed-content hashes, the exact
  backend cross-repository attestation commit plus binding-document SHA-256,
  the target mode, every production dependency, and the exact rollback
  snapshot. Command Center decisions must repeat this hash. Changing a
  migration, Session Authority value, production dependency, target mode, or
  rollback field therefore requires a new exact-subject clearance.
- `detachedRecordSha256` is printed by the verifier and identifies the complete
  record, including later deployment evidence. It is never written back into
  the record.

## Required order

1. Copy `release-record.template.json` to an evidence-only location. Never edit
   the template itself for a release. Set both `reviewAuthorityMode` fields to
   the exact configured service mode, either `manual_review` or
   `autonomous_ai`; the verifier requires them to be equal. Set `targetMode` to
   `disabled` for `dark_staging` or `enabled` for the existing staging path.
2. Finalize the five-component backend release set first. Its attestation
   commit must have the exact backend candidate as its sole parent and change
   only
   `services/autonomous-approval-v1/release/cross-repository-release-binding-v1.json`.
   Record that attestation commit and the SHA-256 of the exact binding-document
   bytes. A branch, tag, backend package hash or deployment alias is not a
   substitute for this binding.
3. Insert the final Website commit, reviewed diff hash, the values from the
   approval service's generated `release/production-packed-artifact.json`, and
   the exact cross-repository attestation values.
4. Populate every passed validation gate, every production dependency, and the
   exact previous deployment/configuration rollback snapshot. The Website
   migration inventory must contain, in order, `0001_projection_records_v1.sql`,
   `0002_custom_launch_wallet_profile_v2.sql`, and
   `0003_registry_custom_public_read_v1.sql`, each with its exact file SHA-256.
   `migrationDigest` is the canonical digest of that complete ordered inventory;
   a digest of only `0001` and `0002` is invalid.
5. Populate the non-secret Session Authority configuration. The record binds
   the existing public Privy application id plus `audience`, `keyId`,
   `keyEpoch`, authority public-key SPKI SHA-256, workload issuer, workload
   subject, workload key id, workload public-key SPKI SHA-256, and the derived
   `configurationEvidenceSha256`. The evidence digest also binds the
   production-authority candidate commit observed in the signed cross-repository
   attestation. Do not record either PEM, the signing private key, the Privy
   secret, a session credential, or a workload token.
6. Run the verifier with live cross-repository verification, fill the canonical
   migration and Session Authority evidence digests it requires, then copy its
   final computed release-subject hash into `subject.releaseSubjectSha256`.
7. Command Center clears the freeze for that exact subject. Record the decision
   id, canonical `command-center://decision/<decision-id>` reference, timestamp
   and SHA-256 of the exact decision text.
   General publishing permission, a request for speed or a green test is not a
   freeze-clearance reference. Clearance must be later than the bound gate and
   rollback evidence. Any dependency or rollback change invalidates it.
8. Commit an enabled staging record to the dedicated record branch, then dispatch the
   reviewed production workflow with its exact record commit and detached
   digest. The workflow reads the exact backend attestation commit through a
   read-only GitHub credential, requires that it has the backend candidate as
   its sole parent, requires that it changes only the binding document, hashes
   the exact Git blob, validates the closed five-component document, and
   compares its Website commit and backend package hash with this release
   record before build or candidate staging.
9. After staging, create the next detached record revision that binds the
   workflow run, exact Website commit, immutable deployment id/URL,
   approval-service package hash, cross-repository attestation commit,
   binding-document SHA-256 and verification evidence.
10. Obtain a separate Command Center promotion decision that names the exact
   candidate and repeats both cross-repository binding values. Freeze clearance
   alone never authorizes promotion.
11. After promotion, complete the authenticated and bounded Ethereum canaries.
   A separate Command Center live declaration is required before the record can
   verify at `live` level.

Do not store tokens, private keys, database URLs, passwords, provider secrets or
credentials in this record. Store only public identities, immutable references
and cryptographic evidence digests.

## Verification

```bash
# The untouched template is structurally valid but not releaseable.
npm run release:custom-launch:record:verify -- \
  docs/operations/releases/custom-launch-v1/release-record.template.json \
  --require template

# Each later level is fail closed.
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require clearance \
  --verify-cross-repository-attestation
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require dark_staging \
  --verify-cross-repository-attestation
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require staging \
  --verify-cross-repository-attestation
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require candidate \
  --verify-cross-repository-attestation
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require promotion \
  --verify-cross-repository-attestation
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require live \
  --verify-cross-repository-attestation
```

`dark_staging` requires `targetMode=disabled`, every validation gate, every
production dependency, the exact rollback snapshot, exact-subject Freeze
Clearance, and empty candidate, promotion, promoted, canary, and live fields.
It cannot satisfy enabled `staging` and does not authorize the enabled staging
workflow. `staging` requires the same closed evidence with
`targetMode=enabled`; changing from dark to enabled changes the release subject
and requires a new exact-subject clearance. `candidate` then requires the exact
protected-workflow and immutable deployment binding. `promotion` additionally
requires a candidate-specific Command Center decision. `live` additionally
requires the promoted identity, canary evidence and live declaration.

Every invocation first validates the complete record with the checked-in JSON
Schema Draft 2020-12 contract through AJV. Unknown properties are rejected at
the root and in every nested object before any state-specific semantic check.

The protected workflow compares the staging record with its exact Website
commit, reviewed backend artifact, protected cross-repository attestation
commit and binding-document SHA-256, current rollback deployment and supplied
detached-record digest before it builds or stages an enabled Custom Launch
candidate. It must additionally supply
`--expect-session-authority-configuration-evidence-sha256` from independently
materialized production configuration so public configuration substitution is
rejected before staging. The protected production environment must expose that
digest as
`PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256`.
The staged readiness response separately publishes the derived non-secret
runtime configuration hash; the dark and enabled probes compare it with the
same record before retaining evidence. The protected production environment must set
`PROGRAMMABLE_BACKEND_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA` and
`PROGRAMMABLE_BACKEND_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256` to the exact
values independently materialized by the backend release verifier. The
workflow also requires the production-environment secret
`PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN` with read-only access to the exact
private backend commit. The credential is read only from the environment and
is never written to the record, summary or workflow log. The retained closed
summary contains only public commit and digest evidence. The workflow remains
stage-only. Any later promotion needs an updated, candidate-bound record and
its separate Command Center decision.
