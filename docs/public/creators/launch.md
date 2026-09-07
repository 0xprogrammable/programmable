---
description: Configure a Module Mode coin or launch a project through the Custom Launch API
---

# Launch a project

Choose Module Mode for a coin with optional modules, or Custom Launch for your own contracts and execution logic.

## Module Mode

Open the [Module Mode builder](https://programmable.market/launch/modules). Configure the coin, creator fees, initial buy and any modules. The builder checks the selected configuration before wallet review. After launch, open the coin's controls from its page or your profile. The [Module Mode guide](../models/module-mode.md) describes configuration and management.

## Custom Launch

Follow [Launch through the API](../developers/custom-launch-quickstart.md). It covers network selection, contract layout, API keys, fees, funding, submission, wallet signing and error recovery.

| Network and layout | Interface |
| --- | --- |
| Robinhood, separate token and hook | V4 and the compatible CLI from [discovery](https://programmable.market/.well-known/programmable.json) |
| Robinhood, shared token/hook contract | [MultiRole V2](https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md) |
| Ethereum Mainnet | V3 at `https://api.programmable.market/v3/custom-launches` |

Check capabilities before choosing the implementation. The MultiRole economic verifier recognizes the exact Native20 reference contracts and supported constructor configuration. Other source or economic mechanisms can return `evidence_required`; follow the stated requirement before expecting a wallet handoff.

## Fees and funding

Robinhood Native20 charges **20 bps (0.20%)** of gross native ETH per successful buy or sell for Programmable, rounded up to the next wei. Creator fees and pool fees are additional. The platform recipient is fixed at `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`.

Choose creator buy and sell fees explicitly. A 0% creator fee produces no Creator Rewards from those trades. ETH already credited to a recipient remains earned even before it is claimed. [Fees and revenue](../economics.md) explains the calculation and the [Dune dashboard](https://dune.com/programmablehq/analytics).

Record launch capital and gas separately. For V4 profile 4.1, include its atomic initial buy and positive minimum token output. Read the public initial-buy quote before packing and follow the fresh quote required by the server. MultiRole uses the funding configuration defined in its own guide.

An ordinary Uniswap v4 pool needs a funded liquidity position. Initializing the pool does not add liquidity, and volume cannot create initial liquidity from nothing. A custom reserve or settlement model must be implemented by the project's contracts and covered by the selected API's verification.

## API key and wallet

Create or reuse a key in the [API-key manager](https://programmable.market/developers/api-keys). It needs the intended chain grant, controller binding, `custom-launch:create` and `custom-launch:read`. Store the value as `PROGRAMMABLE_API_KEY` in an encrypted secret store.

The API key authorizes API operations. The controller wallet separately reviews, signs and sends the transaction. Check the network, destination, calldata, value and expiry before sending.

## Follow the result

Save the exact request, idempotency key and returned launch ID. Use that ID for status reads. Retry the same request with unchanged bytes; a timeout is not a reason to create another launch.

`action_required` means follow the returned remediation. `authorized` provides the exact wallet transaction. After it is sent, track the request to `finalized`, then inspect source verification and indexing. A successful API request is not an external audit or a guarantee of liquidity or trading support.

After launch, share the chain and contract address. A material contract or configuration change creates a new launch subject; an earlier result does not cover changed bytes.
