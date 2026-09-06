# Review contract and evidence boundaries

This package is an unreviewed candidate. A syntax-valid, source-complete request is not admission. The unit tests exercise the actual source runtime with a clearly identified callback harness; the host's independent PoolManager/launch/fee/indexing proof remains necessary.

## Behavior and actors

Eligible buys are completed authenticated native buys before `endsAt`, at least `minimumGrossNative`, optionally excluding the initial buy. Every `everyN`th eligible buy credits its **actual trade actor**, provided the instance already has `rewardNative` available. The count is deterministic and public. A skipped reward creates no debt; later funding does not retroactively credit an earlier buyer. No ETH receiver is called during reward or refund callbacks.

The engine is responsible for actual actor/payer/recipient identity, accurate gross native amount and sequence/exactness semantics. The program trusts only its bound runtime to provide these facts. A public router may not accept a forged actor in arbitrary hook data. All six configuration fields and the runtime/launch/instance/config binding have no setters. The factory and program have no owner, admin sweep, upgrade path, pause or external mutable dependency.

## Value and authority

| Resource | Allowed operation | Boundary |
| --- | --- | --- |
| Own prefunded instance budget | Backed credit to the actual winner or fixed refund wallet | Cannot spend another instance or create debt |
| Existing winner claims | Common host pull claim | Refund cannot consume or redirect them |
| Unused budget after expiry | Fixed refund wallet submits `reclaim-unused` | Only `available`, exact actor and time, no arbitrary recipient |
| Funding after expiry | Same rules as earlier funding | The fixed refund wallet can reclaim it; warn a funder before signing |
| Author royalties | None in this program | The host controls family eligibility and fee accounting |
| Platform/Creator/CTO fees, token supply and LP | None | No rights are granted by this package |

The public descriptor's contributor `rewardWallet` is not this program's configurable budget `refundWallet`. One author/family claim or API identity must not be inferred from a source field. Economic review must exclude duplicate/inert families added only to dilute the author share.

## Exact admitted envelope

The contract accepts `everyN` in 1…2³²−1, positive uint128 minimum/reward values, a uint64 `endsAt` strictly greater than construction time, an explicit boolean and a nonzero refund wallet. It accepts exactly 192 bytes. Runtime validation also binds the complete configuration hash, factory and module code hashes, package identity and callback gas.

Admission of this factory covers **all constructor-valid configurations**. A manifest hash, UI slider or offchain schema cannot enforce a narrower safety envelope. If reviewers require narrower rules, enforce them in a separately reviewed factory/program/validator and publish a new code hash. The construction and action checks remain mandatory even when the UI validates inputs.

## Composition and failure

The program emits no privileged external calls and only uses the active-instance budget capability. It can compose with other modules that the host admits. If any callback reverts or exceeds its gas budget, the entire trade/action must roll back, including earlier credits and state. The runtime limits callbacks and credits. The reference requests 300,000 gas per callback; integration must measure the selected recipe under its actual chain/engine limits.

This reward is predictable, not random or Sybil-resistant. Traders can split activity, use multiple wallets or compete for the Nth position; a buyer cap on wallets does not solve person-level identity. The UI must not market guaranteed returns, fairness or guaranteed reward availability. `minimumGrossNative` is a nominal native amount, not a USD promise. The tokenized-stock, leverage and arbitrary-asset ideas require separate engines/dependencies/rights review; this native capability does not silently provide them.

## Website and common state

The immutable input mapping and action are declared in `runtime-binding.json`. `ui/management.json` provides read bindings, simple controls and connected-wallet, wrong-chain, unverified-binding, wrong-role, empty, expired, stale, pending and failure states. It requests no images, external content or JavaScript execution. A new module needing charts, assets or additional controls must include its pinned assets and inert renderer requirements in the package; an unsupported control cannot silently disappear while a required operation becomes unusable.

The host must derive actual runtime/vault/program addresses from verified launch bindings, check code hashes/config/family admission, render roles from chain state, use exact integer units, read nonce and chain timestamp immediately before building the transaction, and show decoded target/value/effect. Reads are not cached proof of authority. The module cannot alter common host wallet permissions. Claims remain usable after reward expiry.

## Reviewer handoff

- Complete uploaded bytes, descriptor/package/family IDs, author-bound API identity, source licenses and exact dependency hashes.
- Exact compiler/EVM/optimizer/metadata settings from `foundry.toml`; `build-reference.json` records local creation/runtime hashes for the program and factory. Reproduce them independently and verify deployed code before admission. Runtime copies are test dependencies, not replacement host deployments.
- All ten local tests, including 1,000 financial-conservation fuzz cases, plus independent malicious-callback/reentrancy/runtime and real PoolManager/engine integration evidence from the host release suite.
- Contract and economic review of the full configuration envelope, callback gas, identity assumptions, immutable code/dependencies, role/actions, funding, exhaustion, expiry and refund claims.
- Actual website rendering/action support and verified source/contract/launch/indexer bindings. Descriptor validation does not implement these features.

Neither compilation nor uploading this reference satisfies the last two items automatically. No approval, deployment, source verification, wallet ownership, mainnet compatibility or public availability is asserted.
