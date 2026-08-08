# Hookemon platform gate request

## Purpose

This document asks Programmable maintainers for the remaining platform-owned inputs needed to complete the public
Hookemon review. It does not change the Hookemon application, select a candidate, approve a deployment or authorize a
wallet transaction.

The request is bound to these exact public records:

- Programmable application pull request: [0xprogrammable/programmable#126](https://github.com/0xprogrammable/programmable/pull/126)
- application pull-request head: `de33dcaefc9180e72e21130d5f095d50d90212d6`
- Hookemon repository id: `1324982531`
- Hookemon source commit: `bde2d0e5ac4a060375f6c9e150b5a26d17acb7e2`
- Hookemon source tree: `e1fc86b3a209b91eb700065464382d63682f9911`
- builder-declared auditor packet: `79973d87b4b1564f3af42309377ac343503fd874`
- auditor packet pull request: [hookemonv4/hookemon#9](https://github.com/hookemonv4/hookemon/pull/9)
- independent-review request: [hookemonv4/hookemon#10](https://github.com/hookemonv4/hookemon/issues/10)

A different application head, source commit, source tree, compiler or dependency closure is a new review target.

## Current verified boundary

The latest Programmable review records the source revision as reproducible and leaves two independent gates open:

1. an attributable independent security record for the exact source, compiler and dependency closure, build info and
   deployable artifacts; and
2. a trusted Programmable-owned typed normal-CREATE preparation adapter with an exact unsigned end-to-end receipt.

The `Security` and `Verify` workflow runs for the current application head also completed with `action_required` before
creating any job or artifact:

- [Security run 31180043168](https://github.com/0xprogrammable/programmable/actions/runs/31180043168)
- [Verify run 31180042490](https://github.com/0xprogrammable/programmable/actions/runs/31180042490)

The public intake check passing does not close either review gate and is not deployment evidence.

## Requested maintainer deliveries

### 1. Independent-review acceptance and disposition

Please confirm the accepted publication contract for a distinct reviewer, or identify the reviewer or review path that
Programmable will accept. The returned record must:

- identify the reviewer publicly and state their independence from the applicant;
- bind repository id, commit, tree, Solidity compiler and settings, dependency locks, build info, source hashes and the
  complete deployable creation/runtime bytecode set;
- record independently reproduced commands and results rather than copying applicant assertions;
- cover all four fee quadrants, partial fills and rounding, ERC-6909 backing and claims, launcher allowance and
  rollback, CycleVault/CCTP authority and finality, automatic reward solvency, and canonical LP identity and exit;
- list findings with severity and disposition, limitations and a final conclusion; and
- use an immutable reviewer-controlled Git commit or a content-hashed record backed by a verifiable reviewer
  signature. A mutable URL without an authenticated content binding is insufficient.

After a conforming record is published, please recheck it against the exact target and explicitly disposition
`BEFORE_SWAP_RETURN_DELTA_CRITICAL`. Applicant reproduction and this request must not be treated as the independent
review.

### 2. Programmable-owned normal-CREATE preparation adapter

Please publish or identify the trusted adapter implementation, version and responsible owner. The adapter must consume
the validated public launch plan as untrusted input and reconstruct the transaction sequence itself. It must not accept
builder-authored calldata, predicted addresses or receipt fields as trusted preparation.

Please also publish the complete list of non-secret public inputs that the applicant must supply before an exact receipt
can be prepared. If a wallet address, current nonce, public policy identifier or other deployment input is still
missing, the adapter must return a typed input-required result that names the missing field without fabricating a
default.

The typed input and validation contract must bind at least:

- Ethereum Mainnet chain id and one public launch EOA;
- consecutive approval nonce `N` and launcher-creation nonce `N + 1` for that same EOA;
- a zero-before-exact USDC allowance precondition and the exact `25,500 USDC` funding amount;
- the launcher creation bytecode and init-code hash, normal-CREATE address derived from the EOA and nonce, and zero ETH
  value;
- the exact Solana USDC ATA and NFT recipient, token salt, hook salt, canonical PoolId and position token id expected by
  the reviewed plan;
- the source, compiler/dependency, build-info and deployable-artifact bindings named above; and
- an expiry plus fail-closed drift checks for nonce, chain, balance, allowance, bytecode, existing code at the predicted
  launcher address, pool state and every derived identifier.

The trusted path must emit exactly two ordered unsigned Ethereum transactions:

1. nonce `N`: approve the exact predicted launcher for exactly `25,500 USDC`, with zero ETH value; and
2. nonce `N + 1`: normal contract creation with no `to` address, exact launcher init code as `data`, and zero ETH value.

The adapter must reject any extra transaction, changed recipient, nonconsecutive nonce, nonzero value, calldata drift or
unbound derived value.

### 3. Exact unsigned receipt

Please publish the deterministic unsigned receipt schema and one exact receipt produced by the trusted adapter for the
accepted Hookemon target. The receipt must include:

- adapter identifier and version;
- canonical typed inputs and their content hash;
- both ordered unsigned transaction objects and deterministic transaction-preimage hashes;
- approval spender, allowance amount, predicted launcher, init-code hash and expected child/pool/position identities;
- source, tree, compiler/dependency, build-info and deployable hashes;
- precondition observations, expiry, and the exact drift checks that were applied; and
- an explicit statement that the receipt contains no signature, private key, credential or broadcast result.

If launcher creation fails after the approval transaction confirms, the earlier allowance can survive. The adapter and
receipt must therefore require an exact zero-allowance revocation before preparing a replacement sequence, then derive
new nonces, a new launcher address and a new receipt. Reusing the failed receipt must be impossible.

### 4. Workflow approval and final platform disposition

Please approve and rerun the two `action_required` workflows for the exact application head. After the independent
record and adapter receipt pass maintainer verification, please publish a final review that names:

- the exact application head and Hookemon source target;
- the independent record URL, content hash, reviewer and finding disposition;
- the adapter implementation/version and exact unsigned-receipt hash;
- the successful workflow runs and required check results; and
- whether `NORMAL_CREATE_TYPED_PREPARATION_REQUIRED` and the independent-review gate are closed.

Only that maintainer disposition may clear the platform gate. The applicant will then update only the closed Hookemon
intake files, rerun the current trusted validator and relevant tests, and request final review.

## Requested response

A maintainer response can close this request by providing:

- [ ] the accepted independent-review publication path or assigned reviewer;
- [ ] the Programmable-owned adapter repository path, immutable revision and owner;
- [ ] the canonical typed input and unsigned-receipt schemas;
- [ ] the exact unsigned Hookemon receipt or a documented reason it cannot yet be produced;
- [ ] approved and completed `Security` and `Verify` runs for the current application head; and
- [ ] an explicit gate disposition bound to the exact hashes above.

Do not post wallet secrets, credentials, private RPC endpoints, signatures or private deployment inputs. Any signing,
broadcast, registry activation, production promotion and live declaration remain separate maintainer-controlled release
steps with their own evidence.
