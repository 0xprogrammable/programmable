# Native Module source configuration

`review-release.json` supplies the private Module review BFF with the independently adopted NativeV2
identity from the actual deployment and source-verification output. Its release digest is
`0xe81f122e0bd21e0984e21c71ffce56f315e82f22e485cc19e0e490d4d5b7bd49`, and its contract source is
`17b64b6613108dbc6ffdf767607bde6ea33343cd`. The file is the exact 3401-byte identity output, SHA256
`36100920548506582be173ef0aeef392b413602fc7f4490c1c758829097aae1e`.

The server accepts only the closed NativeV1 or NativeV2 identity fields, with the exact source
generation, chain, source commit, finality policy, contract pins and computed release digest. NativeV2
also requires its exact economics policy. Browser requests and submitted manifests cannot select or
replace this identity. `null` blocks Native manifest checking and acceptance; an invalid identity
fails closed for those same operations. Source reads, build review and Engine review retain their
independent paths and existing authentication.

Installing a review identity precedes module publication and the lifecycle canary. It grants no
reviewer or publisher authority and provides no lifecycle or activation proof. Acceptance still
requires the exact successful protected source/build, current review revision, canonical host
manifest, acknowledged review areas and existing independent reviewer authorization. NativeV2
manifests also bind the explicit family fee-eligibility decision. An older NativeV1 accepted manifest
does not become a NativeV2 approval when this file changes.

`robinhood.preview.json`, `catalog.json` and `historical-releases.json` remain the existing public
NativeV1 release, catalogue and historical configuration. The private review identity does not change
their availability, launch permissions or the bindings of existing coins. Public activation still
requires the original release, source, lifecycle, finality and publication checks. Active-release
fields, proof digests, arbitrary URLs and request overrides are not accepted in the review identity.
