# Native Module source configuration

`robinhood.preview.json` contains the NativeV2 release configuration. It preserves the exact bytes
of the Backend's `module-mode-native-v2.json` source manifest, including the deployment,
source-verification and completed lifecycle commitments.

| Binding | Value |
| --- | --- |
| Source version | `module-native-v2` |
| Contract source commit | `17b64b6613108dbc6ffdf767607bde6ea33343cd` |
| Release digest | `0xe81f122e0bd21e0984e21c71ffce56f315e82f22e485cc19e0e490d4d5b7bd49` |
| Start block | `57167553` |
| Finality policy | `robinhood-ethereum-finalized-v1` |
| Deployment evidence digest | `0x1d78338a6230dadfdfd5c94595d886a79682380faabc5c8c2fdfc6ad71dc9284` |
| Source-verification digest | `0x7516811126198aeb7c1503b47ab0ac485d01054ab76f5687d4b02a28f3dd309f` |
| Lifecycle evidence digest | `0x613ebdce2ef1057d902da6924bdb1f209bc99b628b3a75f2e63804a5055ac5bc` |
| Economics policy | `0x781124e941c10961779bc0d3ce1606083d16e1af3a03dccbc10d362b81085cc2` |

`catalog.json` is the protected NativeV2 publication allowlist. Each entry binds its exact source
request, accepted review, host manifest, configuration and explicit family fee-eligibility decision.
Its public source, manifest and review files retain the original authenticated export bytes under
`public/developers/modules/<packageId>/`.

The configuration alone does not authenticate a public release. Every new availability sample must
match the exact source installed in the authenticated Backend and verify the immutable publication
files. Backend source installation and the regular product release gates must complete before the
configured NativeV2 source becomes publicly usable.

`historical-releases.json` retains the complete NativeV1 release and catalogue pair for digest
`0x546172aa670b543c19f00a707a0e9328acfd770f3040fbdd03a8bc709f786dee`, contract source
`9a2a1257a1b97dc0658157247890105a26e824ec`. Its existing bytes and public package files are unchanged.
Historical requests select this exact pair and authenticate its source independently. Existing coins
retain their NativeV1 module revisions, fee rules and recipient rights.

`review-release.json` remains the separate identity-only NativeV2 configuration used by the private
Module review BFF. It is the original 3401-byte deployment identity, SHA256
`36100920548506582be173ef0aeef392b413602fc7f4490c1c758829097aae1e`. It grants no reviewer or publisher
authority. Acceptance still requires the exact protected source/build, current review revision,
canonical host manifest, acknowledged review areas and independent reviewer authorization.

The review identity accepts only the closed NativeV1 or NativeV2 fields and computed release digest.
NativeV2 also requires its exact economics policy. Browser requests and submitted manifests cannot
replace it. `null` or an invalid identity blocks Native manifest checking and acceptance. Active-release
fields, evidence digests, arbitrary URLs and request overrides are not accepted in this identity.
