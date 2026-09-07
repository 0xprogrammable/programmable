# Engine host: local static-analysis disposition

This is an implementation handoff, not an independent audit or a passed strict Slither gate.

The scanner results below bind to the money-fix source at `118b15ef028a40f73fa61531b0a024898eaf4f73`.
The later SwapRouter02 compatibility delta changes only the converter's router interface and encoded tuple,
retaining its own deadline and all funding/oracle checks. It has separate selector/deadline/conversion and
fixed-block Robinhood fork evidence in `module-engine-host-v1.md`; no new Slither result is claimed for that delta.

Slither 0.11.5 completed analysis of the new Host, QuoteEngine/Converter, Escrow and Settlement source entrypoints
with solc 0.8.26, optimizer 1000 and Cancun. Dependency/test findings were filtered so the analysis concerns this
change. The local Foundry build-info adapter first failed (`KeyError: output`); direct solc analysis from outside
the Foundry directory then completed. No source detector suppressions were added.

The scanner's result-size warning produced a concrete fix: `ModuleEngineCallsV1` now checks returndata size
before copying, with separate success and revert bounds. `ClassicModuleCalls.read` is reused for fixed context
readback. A test exercises both oversized success and oversized revert payloads and proves nonce rollback.
The CREATE2 input uses explicit byte concatenation, and family checks consume and validate both author and wallet.

Remaining raw findings require the existing independent release review to confirm these source-bound dispositions:

| Entry point / detector | Raw severity | Engineering assessment and relevant evidence |
| --- | --- | --- |
| Host `launch`, `reentrancy-balance` | High | The entry point is transiently `nonReentrant`. Its ledger is constructed internally from the V2 source and `registerPool` cannot re-enter launch/execute. The later balance check verifies actual fixed supply at the new engine. This is not a cached third-party reserve value used to issue claims. Token/ledger constructor binding and asset-callback rollback are tested. |
| Quote Engine / Converter pre-post asset checks, `reentrancy-balance` | High (9 instances after the money-review fix) | These comparisons intentionally prove exact asset debits and newly received ETH/WETH. The converter is `nonReentrant`; engine entry is host-only and the host is `nonReentrant`; PoolManager and converter callbacks have explicit sender/active-operation checks. Removing the comparisons would remove funding proofs. Nine instances cover `_execute`'s two input snapshots, `_convertFees`' quote snapshot, direct unwrap, and five converter quote/WETH/oracle-snapshot paths. Tests cover callbacks, real V3 oracle/impact gates, underpayment, missing funding, slippage and a 1000-case reconciled round trip. |
| Quote tick alignment, `divide-before-multiply` | Medium | `(tick / 200) * 200` intentionally aligns the positive absolute tick to the existing planner's spacing. The requested price remains rational through decimal conversion; tests compare actual normalized starting prices across both asset orders and 6/18 decimals, including a price below one raw quote unit per primary token. |
| Quote fee zero branch, `incorrect-equality` | Medium | The compared value is an amount from the exact cumulative quote-fee computation, not an external balance. Zero defers only the sub-raw-unit fee while preserving its numerator, and still validates the independent fee market. Positive quote fees require qualified conversion and actual ETH. The 0/1/2-decimal, multi-actor split/combined regression proves that this branch cannot discard fees. |
| Quote `Trade memory trade`, `uninitialized-local` | Medium | Solidity zero-initializes the memory struct. Buy/sell branches assign all amounts they consume; zero platform/creator amounts are intentional for rounding/zero-fee cases. The 1000-case test covers 0..10% creator rates and raw amount boundaries. |
| Sell fee carries after PoolManager unlock, `reentrancy-no-eth` | Medium | Sell fees must use the actual gross quote returned by the swap. The resulting carry write therefore follows the authenticated PoolManager call. Engine entry remains host-only behind the host's transient reentrancy guard; hook/callback sender checks reject another caller. Public carry getters grant no mutation rights. Tests reconcile sell output/carries across actors independently from buy carries and prove atomic rollback. |
| Oracle/market-check tuple selection, `unused-return` | Medium (4 instances) | Two `slot0` reads derive the price tick from the actual sqrt price, so the separately reported tick/protocol-fee or unused observation metadata is not needed. The latest written observation is used only for timestamp/initialization; cumulative history comes from the full `observe` window. The zero-fee market probe requires successful validation and a positive minimum, without consuming its informational TWAP/hash outputs. Actual V3 bytecode tests verify written freshness and history. |
| Escrow and Settlement `locked-ether` | Medium (one each) | The common engine ABI is payable, but both profiles explicitly reject nonzero `msg.value`, and their reviewed host input roles only admit quote ERC20. An unsolicited forced ETH balance creates no user claim. A new administrative sweep right was not introduced to silence this detector. |
| Reentrancy-benign/events, timestamp, calls-loop, assembly, complexity and immutable-state suggestions | Low/informational/optimization | State and events lie behind the same host/operation checks. Deadlines intentionally use timestamps. Arrays, gas and returndata are bounded. Assembly is limited to exact runtime patch/call/route-word handling. Per-instance storage is intentional for the uniform runtime contributor profile. These are not claims of an unrestricted engine safety theorem. |

The final Host scan has one raw High balance-check finding and no raw Medium findings. The Quote/Converter/Oracle
scan retains the listed nine raw High and eight Medium findings; Escrow and Settlement each retain their one Medium finding.
Slither therefore exits nonzero for findings. These must not be reported as `0 High/Medium`, `strict pass`,
independent approval or production readiness. The source and behavioral evidence are ready for the existing review
process; deployment/activation gates remain separate.

The independent money review also identified two real implementation defects in the earlier source: per-trade
quote-fee truncation and trader authority over conversion route/minimum. These were corrected in executable
source, not dismissed as detector findings. The exact quote carry, reviewed route/configuration binding and
quote-specific V3 history/depth/impact guard are described in `module-engine-host-v1.md`. Q128 ETH carry preserves
fractional platform entitlements with less than 2^-128 wei truncation per conversion and exact ETH conservation.

At the money-fix commit, the local behavioral suite had 41 tests, including 1000 round-trip fuzz cases and three tests using original
Uniswap V3 factory/pool bytecode. New deployable runtime/initcode
sizes under the pinned Foundry profile are: Host 19,378 / 47,811 bytes; QuoteEngine 19,194 / 34,292 bytes;
Converter 13,212 / 14,003 bytes after the SwapRouter02 delta (previously 13,228 / 14,019);
Escrow 2,842 / 3,897 bytes; Settlement 5,261 / 6,266 bytes. The Host's six static
constructor arguments add 192 bytes to its initcode envelope, still below EIP-3860. These are local build sizes,
not deployed addresses or finality evidence.

A separate standard-JSON recompilation with solc 0.8.26, optimizer 1000, Cancun and no CBOR reproduced
the Foundry bytes and proved Host and QuoteEngine creation/runtime templates byte-identical to the money-fix
commit. The new Converter creation hash is
`0x67b7d75d30b22dc9e4f7fbda2c631dfe6a2541e686c3fd8f371510a4e782f7b7`; its unpatched runtime-template hash is
`0x972f80fdc1a598605b96f5e6cde926a0b6da54d96c25294ae6aedb1119c2c433`. At the fixed Robinhood snapshot,
patching the six actual dependency immutables yields runtime hash
`0xf6ad258e17a89c3159bd8baad134486f11d6bbbcd99a19c5a7267582f38d56ed`, checked against the locally
constructed fork contract. This is not an onchain Converter deployment or source-registration receipt.
