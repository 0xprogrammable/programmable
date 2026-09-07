---
description: Verify the onchain origin of a Custom Launch without confusing provenance with market support
---

# Launch stamps

A launch stamp records that a canonical Programmable Router executed a launch and bound its token, hook, pool and components to one launch identity. Integrators verify the Router deployment, transaction receipt, events and contract lookups against the manifest for that chain and source version.

## Select the correct source

| Launch source | Provenance interface |
| --- | --- |
| Robinhood Custom with separate token and hook contracts | Launch Stamp Router V1 and the [V4 finalized feed](https://api.programmable.market/v4/chains/4663/finalized-custom-launches) |
| Robinhood Custom with a shared token and hook contract | Launch Stamp Router V2 and the [MultiRole finalized feed](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/finalized) |
| Ethereum Router launches | Router V1 under the [Ethereum deployment manifest](https://developers.programmable.family/api/v2/manifest) |
| Module Mode | Native launcher events and getters in the [Module Mode indexer contract](https://programmable.market/api/module-mode/indexer/v1) |

Module Mode has its own provenance interface. Do not reject a verified Module Mode coin because it lacks a Custom Router stamp. A token and hook can share an address in MultiRole; apply the V2 role rules rather than the V1 requirement for distinct component roles.

## Verify a stamp

Read deployment addresses, runtime hashes, ABI, start block and finality rules from the source's published manifest. Confirm the exact successful transaction and correlate its events, then replay the relevant registry lookups at the same canonical block. Store both the API request identifier and onchain Router launch identifier when present; they are different identifiers.

A valid stamp establishes origin and the recorded component bindings. It does not establish an audit, safe behavior, current liquidity, sellability, a price or support in an external terminal. Direct calls to another factory and historical launches do not acquire a stamp retroactively.

Use the [Robinhood integration guide](developers/robinhood-terminal-indexer.md) for Custom V1 and MultiRole V2, or [Verify a launch](developers/verify.md) for the Ethereum Router contract.
