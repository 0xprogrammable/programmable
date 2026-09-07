---
description: Select the canonical source for Module Mode and Custom Launches on Robinhood, or Ethereum records
---

# Index launches

Identify a coin by its chain and token contract address. Select a verifier by its launch source and version, then retain the original source record alongside the normalized coin. Module Mode and Custom Launches can share an index without sharing the same event format.

## Choose the source

| Source | Discovery and verification |
| --- | --- |
| Module Mode on Robinhood | [Native launcher guide](module-mode-indexing.md) and [indexer contract](https://programmable.market/api/module-mode/indexer/v1) |
| Custom V4 on Robinhood | [Router V1 guide](robinhood-terminal-indexer.md) and [finalized feed](https://api.programmable.market/v4/chains/4663/finalized-custom-launches) |
| MultiRole Custom on Robinhood | [Router V2 guide](robinhood-terminal-indexer.md#multi-role-v2) and [MultiRole finalized feed](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/finalized) |
| Ethereum Classic and Custom | [Developer manifest](https://developers.programmable.family/api/v2/manifest), [launch feed](https://developers.programmable.family/api/v2/launches) and [Router verification](verify.md) |

Robinhood Chain is `eip155:4663`; Ethereum Mainnet is `eip155:1`. Never merge contracts with the same address on different chains. API request UUIDs and Router launch IDs are different identifiers and should be stored separately.

## Build a complete index

1. Read the source's current deployment descriptor, ABI, runtime hashes, start block and finality rules. Bind your ingestion configuration to that source version.
2. Scan canonical events or traverse the complete public feed. Pass opaque cursors back unchanged, retain the source's required overlap and deduplicate by canonical event or launch identity.
3. Verify each launch using that source's events, getters, component bindings and finality evidence. Store the source record, block hashes and checkpoint needed to reproduce the result.
4. Commit the records and checkpoint together. On a reorganization, rewind to the last common canonical checkpoint and replay idempotently. Treat incomplete or unavailable coverage as unknown, not an empty result.
5. Add token metadata and market data with their own source, timestamp and quality. Preserve the launch when a name, image, price, pool or chart is unavailable.

## Modules and shared contracts

Module Mode coins are verified against the native launcher, engine and recorded module configuration. They do not need a Custom Router stamp. Store module IDs, versions and configuration as data. A newly published module within a supported engine does not require a coin-specific or module-name allowlist. A new engine interface requires its own source adapter.

MultiRole V2 represents physical components with role masks. A component with token and hook roles can use one address; `roleMask: 3` represents that combination. Do not run V1's distinct-role assumptions against a V2 record. Use `market.token` for coin identity, retain the component's full role mask and verify its runtime under the published V2 contract.

## Provenance and trading support

A verified launch record establishes where a coin came from. It does not prove every trading route, current liquidity, a price, hook safety or fee behavior. Unknown trading behavior must not remove a recognized launch from the index. A terminal can display the identity while keeping quotes or execution unavailable until its adapter supports the exact market.

Fee accounting uses the exact deployed fee source. Count accrual events once, keep recipient liabilities separate and do not count a later claim as new revenue. The launch feed is not a universal fee-claim queue. Ethereum claim integration has a separate [protocol fee claim reference](https://github.com/programmablehq/Developers/blob/main/docs/reference/protocol-fee-claims.md).

## Service freshness

Inspect the selected source's coverage and finalized checkpoint rather than relying on HTTP status alone. The Developer API's normalized Robinhood feed is a separate service from the public Custom V4 and MultiRole feeds. An unavailable normalized response does not establish that no Robinhood launches exist. Use the source interfaces above and [Service status](../status.md) to interpret availability.
