# Engine source configuration

`robinhood.json` is deliberately `null`: no Engine source is activated by this change. `catalog.json`
has no templates or source digest. There are no placeholder contracts, deployment proofs or reviews.

`review-release.json` is also deliberately `null`. The existing private Module review BFF reads this
server configuration for Engine manifest checks and acceptance. It accepts only the closed
`ModuleEngineReleaseIdentity` wire with its exact digest, source commit, chain, profile and contract
pins. Browser requests and submitted manifests cannot supply or replace this installed identity.
Null blocks Engine manifest checks and acceptance; Native review and source/build review remain
independent. Invalid Engine configuration fails closed for the same Engine operations.

The integration owner may install that identity after the actual Engine host deployment and source
binding have been independently verified. This precedes template review and avoids requiring a
published template or completed lifecycle canary to create its review manifest. Installing this
identity does not activate `robinhood.json`, add a catalogue entry, attest lifecycle evidence or grant
reviewer/publisher authority. The existing publication operator must use the same release identity;
the later active release and catalogue still require every proof below. Active-release evidence fields
are not accepted in the identity-only review configuration.

An activated source uses the existing `ModuleEngineRelease` wire and must match the exact source
installed in the authenticated Module Mode authority service. The server never selects an arbitrary
backend, source URL or newer release from a request.

An active catalogue entry has exactly `template`, `requestDigest`, `review` and `reviewedBuild`:

- `template` is the canonical `ModuleEngineTemplate` bound to this source release.
- `review` is the exact accepted historical receipt exported by the existing authenticated owner
  publication operator. Public `review.json` must equal this record.
- `reviewedBuild` is the operator's private `review-build.json` object, containing only `subject`,
  `plan` and `artifact`. It stays in trusted server configuration and is never included in availability.
- `requestDigest` binds the complete public `source.json`, its descriptor and each source byte.

Only protected publication review may install this active allowlist after the existing publisher's
independent revision readback and the source's activation evidence are complete. An unsigned plan,
`catalog-preparation.json`, a locally valid digest or an `available` label supplies none of that
authority. The preparation shape is rejected by the server reader.

Public files use the existing `/developers/modules/<packageId>/{source,manifest,review}.json` paths.
Every new availability sample re-authenticates the exact release. Successful source/manifest/review
verification has the same bounded cache lifetime, byte budgets and request deadline as Native modules.
The cache identity includes the complete release activation, accepted receipt, build and template.

`historical-releases.json` stores up to 32 additive `{release,catalog}` snapshots with distinct release
digests. An exact historical request never falls back to the current source. A later disabled launch
revision does not erase its immutable published template: transaction preparation separately checks
current permissions, while existing coins keep their exact management and claim bindings.
