---
description: Launch a project with its own token, Uniswap v4 hook and supporting contracts
---

# Custom hooks

Custom Launch deploys a project with its own token, hook and supporting contracts through the Programmable Launch Stamp Router. The request identifies the source, network, controller wallet, contract graph, funding and execution plan.

A Uniswap v4 hook is a contract called by a pool at specified points in a transaction. Its permissions and code determine how it handles fees, accounting, access and other pool behavior.

## Select the contract layout

On Robinhood Chain, separate token and hook contracts use the V4 API. One contract implementing both roles uses MultiRole V2. Ethereum Mainnet uses its own V3 contract. Start with [Launch through the API](../developers/custom-launch-quickstart.md) to select the matching client and schema.

Read the selected API's capabilities before building. MultiRole's economic verifier recognizes the exact Native20 reference contracts and supported constructor configuration. A different mechanism can require additional verification. The response identifies missing evidence separately from a demonstrated defect.

## Prepare and launch

1. Build the project from reproducible source and compiler inputs.
2. Record the controller, creator fees, funding source, initial assets and gas budget.
3. Use a scoped API key to preflight and submit the exact request.
4. Follow the resource until it provides an authorized wallet transaction.
5. Review, sign and send from the controller wallet, then track finality and source verification.

The API key and client do not sign or broadcast. Material source, metadata, funding or configuration changes create a different request. Preserve the original bytes and idempotency key when retrying an existing request.

## Fees and liquidity

On Robinhood, Programmable receives **0.20% (20 bps)** on each buy and sell. The creator's fee and the pool's trading fee are added separately. If the creator sets their fee to 0%, they earn no creator fees from those trades. [Fees and revenue](../economics.md) explains the split and includes a 1 ETH example.

An ordinary pool needs a funded liquidity position. Initializing the pool does not supply that liquidity. A project using custom accounting, launch inventory or another reserve model must implement and verify its own settlement behavior. The selected API's funding rules still apply.

## Verify the result

A finalized launch stamp binds the deployed token, hook, PoolManager and pool to the canonical Router execution. Resolve the Router and its verification rules from the published deployment record.

The stamp records provenance. Source verification, available liquidity, sellability, indexing and external audits are separate checks. Use the [verification guide](../developers/verify.md) and [Robinhood indexing guide](../developers/robinhood-terminal-indexer.md) for their exact requirements.
