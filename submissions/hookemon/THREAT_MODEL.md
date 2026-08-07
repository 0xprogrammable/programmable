# Threat model

Hookemon is classified high risk by the local rubric because it combines return-delta accounting, autonomous jobs, multiple custody boundaries, policy signers and third-party services. “High risk” is a review requirement, not a prediction that the prototype is unsafe.

## Assets and custody

| Asset/state | Custody or source of truth | Exit/recovery |
| --- | --- | --- |
| HOOKEMON supply | Fixed-supply ERC-20 and the atomic launcher during its constructor; canonical liquidity and vesting when the transaction completes | No externally observable intermediate custody survives a failure; no pause, blacklist or owner mint. |
| Pre-constructor USDC allowance | The same public Ethereum wallet separately approves exactly `25,500 USDC` at nonce `N` to its predicted normal-CREATE launcher address at nonce `N + 1` | Constructor failure rolls back its child creation, factory registration, pool mutations, transfers and position mint, but not the earlier approval transaction. Revoke the surviving allowance to zero before any later authorized retry. |
| Canonical LP position | Immutable 730-day position timelock, then the bound Ethereum wallet | Only the exact reviewed token ID whose PositionManager PoolKey derives the canonical PoolId is accepted; ordinary hook behavior cannot block release. |
| Programmable/project fees | Hook-owned PoolManager ERC-6909 USDC claims and owner liabilities | Each immutable owner claims only its own liability. |
| Cycle funds | CycleVault, CCTP transit, Solana policy wallet, Collector assets, inbound transit | Pause and reconcile the last confirmed `cycleId`; no arbitrary destination. |
| Reward funds | AutomaticRewardsDistributor USDC balance | Historic roots remain valid; proof-valid settlement pays only unpaid cumulative delta. |
| Index state | Canonical logs plus confirmed reads | Roll back orphaned blocks and replay from the common ancestor. |
| Secrets | Provider secret stores and policy-wallet systems | Rotate/revoke under incident policy; never place keys or signed transactions in public artifacts. |

## Hook boundary

The 14 permission bits are:

```text
beforeInitialize=true
beforeSwap=true
afterSwap=true
beforeSwapReturnDelta=true
afterSwapReturnDelta=true
all other permissions=false
derived mask=0x20cc
```

BaseHook authenticates PoolManager. Every enabled callback also verifies the exact registered PoolKey. `hookData` is ignored. Same-pool swaps, liquidity changes and donations initiated by the hook are forbidden; the only direct PoolManager operations are bounded claim mint/redemption actions.

The central `1.5.0` checker requires its internal-fee projection whenever `directPoolManagerCalls=true`, even when those calls are claim-only. That projection does not add a hidden swap surface: `hook.nestedActions.allowedActions`, the fee-conformance manifest and executable source remain authoritative about the narrower take/settle boundary.

Critical scenarios:

- direct callback from a non-PoolManager must revert;
- wrong PoolId, currency order, hook, quote asset, LP fee or tick spacing must revert before mutation;
- the mined hook address must match the permission mask;
- specified-USDC final delta mismatch must revert rather than charge an unexecuted amount;
- a returned positive hook delta must have an equal ERC-6909 claim and matching owner liabilities;
- exact-output gross-up must preserve requested net semantics or revert;
- claim order must clear only the authenticated owner liability and atomically redeem equal backing;
- claim calls must not reset fee remainders or permit cross-pool netting.

## Cross-network and provider boundary

The hook never calls CCTP or Collector. The operator is a separate failure domain.

- Each cycle has one idempotency key and only one in-flight bridge direction.
- Ethereum-to-Solana mint recipient must be the configured USDC associated token account, not the wallet owner address.
- Standard/Forwarding Service is default. Fast is allowed only by explicit configuration and fee cap.
- Collector machine data older than 120 seconds, missing odds/floor/price, insufficient stock or malformed API data stops purchases.
- Every pack has a unique memo. Generate, submit, open, buyback and status calls are reconciled before retry.
- The Collector signer accepts only legacy transactions whose fee payer, provider signatures, memo, programs, token transfers, mints, decimals, amounts and accounts match the cycle-scoped intent and reviewed allowlists.
- `getGenesisHash` must match the configured Solana cluster and `isBlockhashValid` must return true at `confirmed` commitment immediately before signing; versioned, malformed, oversized or expired transactions fail closed.
- Player and temporary NFT recipient are the same policy wallet. Manual buyback must transfer exactly the opened NFT to an allowlisted Collector account and exact USDC to the configured recipient ATA.
- A durable exclusive intent reservation binds action, `cycleId` and pack identity before the raw signer runs. Restart and provider retry paths reconcile status first and never authorize a second message for that action.
- A timeout is never proof of failure or success. The operator queries the provider and chain before resubmitting.
- A crash after provider acceptance but before the PostgreSQL commit is handled by provider-side `cycleId`/memo reconciliation; a local checkpoint alone is insufficient.
- Collector key, wallet material, serialized signed transactions and email codes must never enter logs, Sentry, the API or Git.
- The intent store contains only public identifiers and message/intent hashes; raw transaction bytes and signatures are not persisted there.

## Reward/indexer boundary

- Same-block transfers are ordered by transaction/log index.
- Mint and burn do not create zero-address eligibility.
- Reorgs replace the orphan branch and recompute time-weighted balances.
- The exact exclusion list is versioned and public; a hidden exclusion or treasury reclassification is prohibited.
- Cumulative leaves bind `chainId`, distributor, epoch, account and amount using OpenZeppelin StandardMerkleTree double hashing.
- All earlier unpaid accounts remain in later cumulative roots.
- `paid[account]` prevents duplicate value release across epochs; a changed amount invalidates its proof.
- Empty roots are not published. Funding must cover newly committed cumulative entitlement.
- Gas policy can delay, but not expire or confiscate, a holder balance.

## Service/API/UI boundary

- The public API is GET-only and returns explicit projections; internal errors become a generic 503 without provider headers or credentials.
- Privy login is optional for holders and cannot change rank, entitlement or payment recipient. One Privy Ethereum wallet and one Privy Solana wallet perform the bound production actions.
- Website figures must come from the read API or be labeled prototype/static. It must not call a simulation “live”.
- Collector/CCTP/RPC status is third-party evidence, never a substitute for confirmed chain custody.
- Pokémon-related names are descriptive only; no official Pokémon art, logo, affiliation or guaranteed card value is claimed.

## Authority abuse and failure

| Threat | Control and remaining risk |
| --- | --- |
| Registrar registers hostile pool | The hash-bound atomic launcher is the one-time registrar; strict PoolKey checks, independently derived PoolId and constructor-only execution prevent a later registrar action. |
| Privy Ethereum authorization is lost | Deployment administration, pause and routine Ethereum actions stop. On-chain trading, existing liabilities, vesting and LP timelock continue; recovery requires reviewed Privy credential rotation. |
| Privy Ethereum authorization or policy is compromised | One wallet occupies every Ethereum authority. Typed destinations, zero arbitrary value, amount bounds, 48-hour configuration delay, treasury vesting and LP lock limit immediate loss, but this concentration remains a material single point of failure. |
| Privy wallet or policy binding drifts | Any address, wallet ID, policy ID/hash or undisclosed third wallet mismatch stops mainnet preflight before signer construction. |
| Guardian action is abused | The guardian capability can pause automation but cannot sweep another liability, forfeit holder entitlement or block the immutable LP release schedule. |
| Root publisher overstates rewards | Cumulative artifacts are public/reproducible, but a valid publisher can still commit a bad root; independent reconstruction, policy signer and funding checks are required. |
| Operator repeats bridge/pack | Durable checkpoints plus provider reconciliation and one-direction lock; provider idempotency must be verified live. |
| Readiness monitor mistaken for production automation | Public status and runbook label the current Render command as signer-free monitoring only; transaction activation requires exact adapter composition and a controlled lifecycle rehearsal. |
| Mainnet configuration drifts | A signer-free preflight binds chain identities, runtime hashes, exactly two Privy wallets/policies, Solana custody, CCTP routes, reserves and the PostgreSQL lock; any mismatch stops before signer construction. |
| Collector changes terms | Purchases fail closed on stale/malformed data; written permission and current commercial/API terms are release gates. |
| RPC lies or lags | Confirmed-block reconciliation, block-hash checkpoints and failover; multiple independent RPC classes are still required for production. |
| Gas exhaustion | Sponsor runway alerts, max-40 batches and value-to-gas threshold; small payouts can be delayed. |
| Pack losses | Disclose uncertain outcomes; cap order count and favor floor lane. Loss is borne by the reward pool, never by a promised redemption. |

## Known limitations

- The bound application source is GitHub repository ID `1324982531`, merge revision `bde2d0e5ac4a060375f6c9e150b5a26d17acb7e2`, tree `e1fc86b3a209b91eb700065464382d63682f9911`. Actions run `31128237847`, attempt 2, is separate runner-backed evidence at CI head `1595fb968666f5db81a88592bb88d431dc4e14b6` on that same tree. Source parent `3c1503bb8520da61b6c4da637afb93f3d6b7dd7f` is only the recorded origin for regenerated static-analysis, gate-status and test-evidence metadata, not an alternative source binding.
- The intended root sequence is same-wallet normal CREATE: nonce `N` approval, then nonce `N + 1` launcher creation. CREATE2 is child-only for the token and hook. Existing constructor, DeploymentPlan and decoy-position fixtures are synthetic; they do not prove that production N/N+1 sequence.
- `NORMAL_CREATE_TYPED_PREPARATION_REQUIRED` remains unresolved. A separate trusted typed normal-CREATE adapter/schema plus the exact end-to-end unsigned receipt must bind the public wallet, consecutive nonces, Solana USDC ATA, token salt, hook salt, canonical PoolId and PositionManager token ID before R3/R4 can be considered resolved.
- A pinned Ethereum fork at block `25684536` and a separate current-head smoke at observed block `25688219` pass against the reviewed PoolManager, USDC and Circle TokenMessengerV2 addresses. No deployment receipt, source verification, runtime match or incident drill exists yet.
- The deterministic builder closes the declared Foundry and JavaScript source graph without diagnostics. Maintainer dependency review is still required because the project uses a model-specific pinned baseline.
- Owner-approved option A fixes the atomic token allocation, 25,000 USDC launch liquidity, 500 USDC CycleVault bootstrap, treasury vesting and exact-position 730-day LP custody. The owner approved exactly one Privy Ethereum wallet for every Ethereum role and one Privy Solana wallet for every Solana role; concentrated application authorization remains a mainnet review item. Exact public bindings and Collector permission remain separate deployment gates. Hookemon supplies no swap client in this submission; a future platform or third-party routing surface is a separate review boundary.
- Third-party uptime, future API semantics, pack outcomes, token price, trading volume and payouts cannot be guaranteed.

## Static-analysis dispositions

Builder-declared Slither `0.11.6` evidence retains exactly 10 findings. The normalized report digest is `sha256:667ab4743dd744526b8a4d1399fb401ffda8691ad769aacf588ddf669a9b4d6e`. These dispositions are review evidence, not an audit or approval.

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | High `reentrancy-balance`, `CctpForwardingBridgeAdapter.sol:95-123` | Reviewed false-positive pattern: `nonReentrant`, once-bound vault access, pre-call cycle marking, cleared allowance, exact USDC decrease and rollback tests are the controls; mainnet dependency and runtime observation remain required. |
| 2 | Low `timestamp`, `CycleVault.sol:90-104` | Accepted timing dependency for the minimum 48-hour configuration delay. |
| 3 | Low `timestamp`, `HookemonAtomicLauncher.sol:321-351` | Reviewed taint false positive plus accepted launch clock for constructor-established four-year vesting and 730-day LP schedules; asset and custody postconditions remain exact. |
| 4 | Low `timestamp`, `HookemonPositionTimelock.sol:119-131` | Accepted timing dependency for the immutable-beneficiary 730-day position lock. |
| 5 | Informational `cyclomatic-complexity`, `AutomaticRewardsDistributor.sol:81-130` | Accepted bounded max-40-recipient batching; independent review must still inspect the complete payout path. |
| 6 | Informational `cyclomatic-complexity`, `HookemonDeploymentPlan.sol:217-258` | Accepted bounded, pure, fail-closed one-plan validation complexity; no loop, mutable state or external call. |
| 7 | Informational `too-many-digits`, `HookemonDeploymentPlan.sol:217-258` | Reviewed hash/numeric false positive for typed hook init-code hashing and CREATE2 identity, not an ambiguous monetary literal. |
| 8 | Informational `too-many-digits`, `HookemonDeploymentPlan.sol:260-273` | Reviewed hash/numeric false positive for typed token init-code hashing and CREATE2 identity, not a human-entered numeric literal. |
| 9 | Informational `too-many-digits`, `HookemonDeploymentPlan.sol:308-329` | Reviewed hash/numeric false positive for the compiled launcher init-code hash and typed `LaunchConfig`, not a parsed monetary digit string. |
| 10 | Informational `too-many-digits`, `HookemonAtomicLauncher.sol:353-369` | Reviewed hash/numeric false positive for the fail-closed identity/code/USDC-decimals guard, not an ambiguous monetary constant. |
