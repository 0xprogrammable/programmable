# Creator fee recipients, CTOs and large payout lists

This local extension implements administrative changes to **future Creator fee destinations**. It does not change swap fee rates, the fixed 20-bps platform charge, module-author attribution, existing balances, locked liquidity or token control. A zero-Creator-fee coin remains zero after CTO. Dashboard and application UI are later work.

## Administrative operation

The immutable ledger `rewardAdmin` and `treasury` addresses each authorize `replaceCreatorWallets(poolId, newWallets, expectedAdminRevision, deadline)`. An ordinary externally owned wallet can act as administrator; no new multisignature or platform launch signer is introduced.

`creatorRecipients(poolId)` returns the current ordered wallets, their immutable slot weights, and the current administrative revision. The new list must have exactly the same slot count and every address must be nonzero. Repeated destinations are allowed: all old slots can point to the new team's single ordinary wallet. All entries are checked before any changes. A transaction either replaces the complete list or changes nothing.

The revision increases only on successful administrative batches. It is separate from beneficiary self-rotation, so an outgoing creator cannot block a CTO by continually moving their own wallet. A stale administrative revision or expired/zero deadline fails. Reaffirming the same wallet list also increments the revision, invalidating an older pending administrative decision without changing recipients.

`changeCreatorWallet(poolId, index, newWallet)` now belongs exclusively to the current slot beneficiary. Administrators use the protected batch entrypoint even when only one destination changes. This closes the old unversioned administrative single-slot path. The original `configurationHash` continues to describe launch-time configuration; use the current-recipient getter for dashboard state.

Individual changes emit `CreatorWalletChanged`; the complete administrative decision emits `CreatorRecipientsReplaced` with administrator, new revision, destinations and the cumulative Creator-fee amount at the transition. Creator amounts already credited stay at their old beneficiary. Previously accumulated fractional rounding carry is credited when it becomes a whole unit, as in the existing ledger.

## Up to 1,000 recipients without 1,000 swap writes

`ClassicCreatorFeeSplitterV1` is an immutable native-currency payout contract. A ledger slot can name this address just as it can name an ordinary wallet. The ledger's swap work remains bounded by its existing direct slots and selected modules; it neither enumerates nor calls the splitter's 1,000 beneficiaries during trading.

The splitter constructor accepts compact `bytes allocations`: each row is a 20-byte address followed by a two-byte big-endian basis-point share. There are 1–1,000 strictly ascending, distinct, nonzero addresses; the splitter itself is excluded. Every share is positive and the complete verified sum is 10,000. The complete list, rather than a claimed root/total, is validated onchain once.

Compact data matters: two ABI arrays of 1,000 addresses and 1,000 shares alone exceed the EVM init-code limit when embedded in constructor arguments. The 22-byte rows keep this constructor within that limit. `AllocationConfigured` emits the complete compact list so claims can be reconstructed independently of a hosted application.

Merkle leaves are `keccak256(bytes.concat(keccak256(abi.encode(domain, uint256(index), wallet, uint16(shareBps)))))`, where `domain = keccak256("programmable.classic.creator-split.v1")`. The list is padded with zero hashes to the next power of two. Internal nodes use OpenZeppelin `Hashes.commutativeKeccak256`; proofs use `MerkleProof.verifyCalldata`. Exact proof depth is checked and never exceeds ten. The shared SDK fixture binds both implementations.

The constructor fixes root/count/depth forever. There is no administrator, owner, root setter, sweep or upgrade in the splitter. `ClassicCreatorFeeSplitterFactoryV1` binds CREATE2 to the caller, caller salt and complete allocation bytes; `predict` follows the same formula. Public deployment requires exact release bytecode and an authorized wallet transaction.

## Claims and CTO history

A recipient's lifetime entitlement is `floor((nativeBalance + totalReleased) * shareBps / 10000)`. Their claimable amount is that entitlement minus the amount already released for the index. This keeps claim order and payment fragmentation from creating extra fees. Forced native donations are distributed by the same shares. Indivisible residual units remain in the contract and can become claimable with later receipts.

Anyone may call `ledger.claim(splitterAddress)` to release an existing ledger credit to the correct splitter. Anyone may then call `splitter.claim(index, wallet, shareBps, proof)` to pay the exact proven wallet. Only that wallet may call `claimTo(..., destination)` to redirect its own payment. CEI and OpenZeppelin transient reentrancy protection guard each payout. Claims to the splitter itself are excluded.

For a new CTO allocation, deploy a new immutable splitter or use a normal wallet, then replace the ledger's future destinations. The old splitter still receives its already-earned ledger credits and its old beneficiaries can claim them. The new team cannot rewrite the old root or confiscate old credits. Root/configuration and proof availability therefore remain historical data that the later dashboard must preserve.

## Local evidence and boundary

The focused tests cover all 1,000 wallets claiming their correct shares; compact malformed lists, duplicate/zero addresses and invalid sums; substituted proofs/indices/shares; recipient-only redirects; reentrant/reverting receivers; cumulative distribution fuzzing; caller-salted deployment; an actual local Classic launch followed by CTO; and old unclaimed splitter fees across the transition. Gas checks use the real production factory CREATE2 path rather than Foundry's dynamically linked test-level creation shortcut. Local measurements exclude network gas pricing and are not a live Robinhood transaction receipt.

The SDK exports `buildCreatorSplit` and `encodeCreatorTakeover`. The CLI command `prepare-creator-split --recipients recipients.json --out creator-split.json` prepares data without signing or deploying. Neither the CLI nor a future form may treat a caller-provided ledger address, admin revision, deployment digest or proof list as release authority. Module authors remain separate from Creator/CTO recipients; a larger payout list does not increase the maximum eight executed module families per launch.
