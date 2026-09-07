---
description: Verify Module Mode and Custom Launch records using the correct chain and source
---

# Verify a launch

Start with the chain and the launch source. A token address alone does not identify its network or prove that it was launched through Programmable. Use the published deployment and source contract to select the event decoder, record format and finality rules.

## Choose the source

| Launch | Verification reference |
| --- | --- |
| Module Mode on Robinhood Chain | [Native Module Mode source](module-mode-indexing.md) |
| Robinhood Custom with separate token and hook contracts | [V4 with Router V1](robinhood-terminal-indexer.md#bind-the-exact-identity) |
| Robinhood Custom with a shared token and hook contract | [MultiRole V2 with Router V2](robinhood-terminal-indexer.md#multirole-v2) |
| Classic and Custom on Ethereum | The Ethereum manifest procedure below |

The [indexing guide](indexing.md) explains how these sources share a coin identity while keeping their provenance records separate. Use `(chain, token address)` for the coin and retain each source's own launch identifier.

## Verify Robinhood launches

Module Mode uses its native launch contract, launch record, program and deployment bindings. It does not require a Custom Launch stamp. Select the release and verifier from the module indexer contract and validate the canonical receipt and record before publishing a coin.

Separate-contract Custom Launches use V4 and Router V1. Shared-role launches use MultiRole V2 and Router V2. Read the corresponding finalized feed, preserve its complete source and finality evidence, and reproduce the required Router lookups and receipt checks. A shared token and hook address is valid when the V2 component's role mask binds both roles; applying V1's distinct-role rule to that record is incorrect.

Keep Robinhood L2 inclusion, Ethereum posting and Ethereum finality separate. Their coordinates and response fields differ between source versions. Follow the selected reference instead of copying a block number or event decoder from another profile. A project's API resource ID and its onchain launch ID are also distinct identifiers.

## Verify Ethereum launches

Fetch the [Developer manifest](https://developers.programmable.family/api/v2/manifest), select Ethereum chain ID `1`, and require the `launchStampRouter` entry to be live. Verify the Router runtime hash and ABI SHA-256 before using its published events or getter selectors.

Backfill Router events from the manifest start block and follow its finality policy. Extract the launch ID, token, hook, PoolManager and pool ID. Cross-check the appropriate point lookup, `launchStamp` and `stampProof` at the same canonical block. The hosted launch feed is a discovery aid; it does not replace these onchain checks.

The token lookup identifies a token's launch record, while the pool lookup binds the market used by a trading integration. A component lookup must not identify one launch when that component is shared infrastructure. The [Developers repository](https://github.com/programmablehq/Developers) contains the complete Ethereum verifier and conformance fixtures.

## Interpret the result

Assign a Programmable label only when the selected source's identity, runtime, record and proof agree. Preserve missing evidence and conflicting evidence as explicit outcomes. Do not turn an unavailable provider response into a finding that a coin was not launched through Programmable.

Provenance, source verification and finality are separate results. A valid launch record does not establish present liquidity, sellability, trading support, an external audit or future price. Verify those properties independently when an integration needs them.
