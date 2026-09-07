---
description: Check launch availability, request progress and indexing freshness
---

# Service status

Use the status interface for the operation you are performing. API availability, a launch's progress and the freshness of an index are separate states. A successful HTTP response does not by itself establish that a new request can be authorized or that a feed has reached the current finalized block.

| Service | Status source |
| --- | --- |
| Module Mode | [Active engine and catalog](https://programmable.market/api/module-mode) |
| Custom Launch API | [API readiness](https://api.programmable.market/readyz) and [product discovery](https://programmable.market/.well-known/programmable.json) |
| Robinhood V4 | [Chain readiness](https://api.programmable.market/v4/chains/4663/readiness) |
| Robinhood MultiRole | [Capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) and the context linked by that response |
| Ethereum Developer API | [Index status](https://developers.programmable.family/api/v2/status) |

## Launch requests

Use the status URL returned for your request. V4 and MultiRole have separate clients and resource contracts. Follow the reported remediation when evidence is missing; only an authorized wallet handoff is ready for transaction review. The [Custom Launch quickstart](developers/custom-launch-quickstart.md) explains API keys, retries and the wallet step.

For Robinhood V4, discovery must report `publicWrites`, `publicAuthorization` and `releaseReady` for both the version and chain entry. Match the ready release to the immutable client release in discovery. MultiRole supplies its own context, readiness and economic verification. The [complete API reference](developers/custom-launch.md) defines the detailed lifecycle and error codes.

## Indexed data

Check the source's finalized checkpoint, scan coverage, cursor completion and data-quality fields. Preserve an existing verified launch if a price or chart provider is unavailable. Keep stale or missing market values explicitly marked rather than guessing replacements.

[Module Mode indexing](developers/module-mode-indexing.md), [Robinhood Custom indexing](developers/robinhood-terminal-indexer.md) and the Ethereum status endpoint publish their own freshness and verification rules. Source verification follows finality and does not change the transaction's finality result. External terminals determine their own ingestion and trading support.
