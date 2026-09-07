---
description: Choose a Custom Launch API, configure fees and funding, and follow the request through wallet signing and finality
---

# Launch through the API

Use Custom Launch to deploy a project with your own token, hook and supporting contracts. Start by choosing the network and contract layout. Then prepare the source, check the request and sign the transaction from the controller wallet.

## 1. Choose the matching API

| Network and layout | Use | Start here |
| --- | --- | --- |
| Robinhood Chain, separate token and hook contracts | V4, using the profile advertised by discovery | [Robinhood workflow](https://programmable.market/developers/robinhood-launch-guide-v1.md) |
| Robinhood Chain, one contract acts as both token and hook | MultiRole V2 | [MultiRole capabilities](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities) and [guide](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md) |
| Ethereum Mainnet | V3 | [Ethereum request and CLI reference](https://programmable.market/developers/custom-launch-api-v1.md#install-the-public-cli) |

Robinhood Chain has chain ID `4663`. Ethereum Mainnet has chain ID `1`. V4 and MultiRole V2 have different request formats and clients. Select the layout before building; a shared token/hook belongs in MultiRole rather than the separate-contract V4 schema.

Read [discovery](https://programmable.market/.well-known/programmable.json) and the selected API's capabilities without an API key. For V4, `publicWrites`, `publicAuthorization` and `releaseReady` must be true in both the V4 and chain entries. For MultiRole, require a complete `context` and `readiness.status: "ready"`. The response names the compatible client, schema and verification rules.

MultiRole's economic verifier recognizes the exact Native20 reference contracts and supported constructor configuration. Different source or economic behavior can return `evidence_required`. Follow the reported requirement; changing an API key cannot add missing verification. Read the [coverage report](https://api.programmable.market/v4/chains/4663/launch-coverage) for V4 architectures such as custom settlement, multiple pools and applications without a pool. Its findings apply to that profile, not to every Programmable API.

## 2. Set the fees and funding

For Robinhood Native20, Programmable receives **20 bps (0.20%)** of the gross native ETH amount per successful buy or sell. The full 20 bps belongs to Programmable. Creator fees and Uniswap pool fees are additional.

For a 1 ETH gross trade, the platform fee is 0.002 ETH. Each trade rounds the platform fee up to the next wei. The recipient is fixed at `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. A claim pays that recipient, regardless of who triggers it.

Choose creator buy and sell fees explicitly. Setting both to 0 means no Creator Rewards accrue from those trades, even while Programmable earns its platform fee. Historical Ethereum contracts follow their own fee policy. [Fees and revenue](../economics.md) explains each path.

Before packing, record:

- The controller wallet, token name, symbol, description and public project links.
- The exact source and compiler inputs for every contract, including dependencies.
- Initial token inventory, real reserves, liquidity ownership and withdrawal rules.
- The funding wallet, transaction value, initial buy and minimum token output.
- Separate limits for launch capital and network gas.

For profile 4.1, read the public [initial-buy quote](https://api.programmable.market/v4/chains/4663/initial-buy-quote). A funded launch needs an atomic initial buy worth at least USD 1 at the server's reference rate and positive minimum token output. Include the buy once in transaction value, with gas budgeted separately. MultiRole uses the funding configuration in its own guide.

Initializing an ordinary pool does not add liquidity. A project using a different reserve or settlement model must implement and verify that model in its contracts.

## 3. Create or reuse an API key

Open the [API-key manager](https://programmable.market/developers/api-keys) with the controller wallet. Use an existing suitable key or create one with the selected chain grant and these scopes:

| Scope | Allows |
| --- | --- |
| `custom-launch:create` | Preflight and creation |
| `custom-launch:read` | Listing, status and access to the wallet handoff |

Store the key as `PROGRAMMABLE_API_KEY` in an encrypted secret store. Send it only to `https://api.programmable.market` using `Authorization: Bearer`. Keep the value out of source files, screenshots, chat and support messages.

The controller must match the key's wallet binding. Partner credentials follow the controller and lineage rules advertised in `customLaunchApi.partnerCredentials`. A key authorizes API requests; the wallet signs and broadcasts transactions.

## 4. Pack, check and submit

Install the compatible client from the immutable release advertised by discovery and verify its checksum. For separate-contract V4 with a complete project configuration:

```sh
programmable-launch pack --config programmable-launch.config.json --output launch.json
programmable-launch validate launch.json --config programmable-launch.config.json --remote
```

Read the returned eligibility, findings and remediation. `TX_SIMULATION_PENDING` with `launchEligibility.deployable: true` means creation performs the remaining transaction simulation. It does not describe a failed key or completed launch.

When the response allows creation:

```sh
programmable-launch submit launch.json --config programmable-launch.config.json
```

For a shared token/hook, use the MultiRole guide's request packer and Node 24 client. Verify their file hashes against the capabilities document. The downloadable reference inputs demonstrate the format; replace their example controller, context, contract bindings, funding and permit window with the complete inputs for your project.

Save the original request bytes, idempotency key and response. A new request returns HTTP `202`; an exact replay can return `200`. For retries, keep the bytes and `Idempotency-Key` unchanged and follow `Retry-After`. Repacking after a timeout can create a different launch request.

## 5. Track and sign the launch

For V4, use the returned `resource.launchId`, shown below as `LAUNCH_ID`. The support `requestId` is a different identifier.

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized
```

`action_required` means follow the returned remediation. It is not a wallet action. An `authorized` response supplies the exact wallet handoff. Check the network, controller, destination, calldata, value and expiry in the wallet, then sign and send.

After sending:

```sh
programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized
```

For MultiRole, follow the returned `statusUrl` and the client's status and finality commands. Keep the original launch ID and request context when recovering an existing launch.

`submitted` does not mean finalized. On Robinhood, the launch follows sequencer confirmation, posting to Ethereum and the required Ethereum finality. Source verification follows finality. Indexing, market data and trading support have their own status. A launch stamp records the canonical deployment; it is not an external audit.

## Resolve common problems

| Response | Next step |
| --- | --- |
| `401 UNAUTHENTICATED` | Check that the intended key is present, active and unexpired. |
| `403 INSUFFICIENT_SCOPE` | Use a key with the scope for this operation. |
| `403 CHAIN_NOT_ALLOWED` | Check the key's grant for the intended network. |
| `WALLET_BINDING_MISMATCH` | Match the request controller to the key's wallet binding. |
| Detail `404 NOT_FOUND` | Check the returned launch ID, API version, chain and credential lineage. |
| `409 IDEMPOTENCY_CONFLICT` | Recover the request already bound to that idempotency key. A deliberate new request needs a new idempotency key. |
| `429` or an explicitly retryable `503` | Honor `Retry-After`; keep the original request bytes. |
| Initial buy below the minimum | Confirm the revised amount within the budget, then update, repack and preflight the request. |
| `evidence_required` or a source finding | Follow the exact source repair or verification requirement. Wider key permissions do not resolve it. |
| Expired permit | Check the existing request and transaction before preparing a replacement. Do not reuse expired wallet bytes. |

For support, provide the public error code, HTTP status, UTC time and `error.requestId`. Include the launch ID when one exists. Never send an API key or wallet secret.

## Reference and statistics

- [Complete request, lifecycle and error reference](https://programmable.market/developers/custom-launch-api-v1.md)
- [Versioned API contracts](machine-readable.md)
- [Robinhood indexing guide](robinhood-terminal-indexer.md)
- [Fees and revenue](../economics.md)
- [Dune analytics](https://dune.com/programmablehq/analytics), refreshed daily. Native20 fee totals include unclaimed accruals and exclude gas, liquidity deposits, LP fees and historical fee models without the supported events.
