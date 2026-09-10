# Custom Launch analytics

[Public dashboard](https://dune.com/programmablehq/analytics) · [Dune query 8631499](https://dune.com/queries/8631499)

The dashboard refreshes every four hours, configured in Dune on 2026-09-10. The query includes its indexed, finalized block and timestamp so readers can distinguish refresh time from the chain checkpoint. A successful launch does not force a dashboard refresh.

`custom-launch-robinhood.sql` counts canonical V1 and both published V2 Launch Stamp Router deployments on chain 4663, including reference launches. The current MultiRole V2 router is `0x4b5Cec6E715C3bCd7e6837E9E307C40C9aCc2B2E`. It checks the public RPC chain ID and finalized head, then reads Dune logs through the latest Dune block at or below that head. Every metric uses this common checkpoint. Missing RPC/checkpoint data fails the query instead of supplying zero fees. `chain_finalized_block` separately exposes the chain head when Dune trails it.

Fee events must come from a stamped hook and its exact pool at or after the launch block. Same-block initial-buy events can precede the stamp. An existence join prevents repeated launch references from multiplying fees. Module Mode fee events are excluded by launch provenance.

Native20 earnings decode `NativeFeesAccrued(bytes32,address,bool,uint256,uint256,uint256)`. Gross native amount, platform fee and creator fee are separate uint256 values in wei. Only display columns convert to ETH. Native20 platform fees equal `ceil(grossNativeWei * 20 / 10000)` per successful trade; the aggregate is the sum of emitted fees, not a rounded estimate from total volume. Creator rewards are separate from the platform fee.

The separate BLOB adapter reads `FeesRecorded(uint256,uint256)` exclusively from its source-verified vault `0xC4b0AE2d8530ddD043c8124bf79297A17166Baf7`. The adapter is bound to BLOB's canonical router, combined token/hook `0x105f6435a4ab3C03C13d4a0dB67961344694d0CC`, pool and launch block. BLOB is explicitly excluded from the Native20 event path, so the two accounting sources cannot count its fees twice. This vault's fixed platform recipient is `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. BLOB's project taxes and game fees are outside this vault's creator-fee ledger and outside these fee totals.

Revenue is earned accrual, including unclaimed balances. Do not add `FeesClaimed`: it withdraws already recorded fees. For Native20, do not also add the vault's `FeesRecorded` events. Gas, liquidity, donations and pool LP fees are excluded. Other fee models remain outside these totals until a verified adapter is added. `launches_without_observed_supported_fees` exposes launches with no observed supported fee events; it can include zero-activity launches and LP-only models, and is not a claim that those projects owe unpaid platform fees.

`volume_eth`, `volume_wei` and `swaps` now use actual `PoolManager.Swap` events for canonically stamped native-ETH pools. A matching `Initialize` event establishes the native currency. Each pool execution is counted once using an existence join, including same-transaction first buys. Volume is the absolute native-side pool delta, not volume inferred from revenue. It excludes hook transfers outside the pool delta. The previous Native20 gross fee base remains available as `native20_gross_volume_wei`. Non-native, no-pool and other custom settlement volumes need separate models. V4's pool volume is included, while its LP fees remain outside platform revenue.

## Verification on 2026-09-10

The candidate ran successfully on Dune and returned checkpoint `59648445`, `2026-09-10 19:20:17 UTC`:

| Metric | Exact result |
| --- | --- |
| Custom launch records, including references | 5 |
| Supported platform earnings | 310799513208732103 wei |
| ARBT platform earnings | 186849654838866631 wei |
| BLOB platform earnings | 75636916217030532 wei |
| Native pool volume | 1985248579789016263279 wei |

ARBT and BLOB earnings were independently summed from complete, bounded RPC fee-log ranges. Each matched Dune exactly and reconciled to lifetime platform claims plus `platformAccrued()` at the same block. Public RPC logs and the Developer-documented historical RPC were used separately for log and historical state reads. Current vault runtime hashes matched the prior exact-source verification. These are snapshot verification values, not live balances.

An independent, paced RPC scan also matched the actual pool volume and swap count at that block: ARBT had 2054 swaps and 93328835588635934262 wei of native-side volume; BLOB had 2229 swaps and 35486187719787992739 wei. RPC throttling was handled by honoring the provider's retry interval. The corrected SQL and coverage description were saved to the existing query 8631499, and the existing dashboard visibly returned 0.310800 ETH supported custom platform revenue and five launch records. No duplicate dashboard was created.

Dashboard counters:

| Visualization | Column | Dune ID |
| --- | --- | --- |
| Custom Launches | `custom_launches` | 12648583 |
| Custom Creator Rewards | `creator_rewards_eth` | 12648604 |
| Custom Protocol Revenue | `protocol_revenue_eth` | 12648609 |

The title image is the supplied original at `public/brand/dune-analytics-title.png`.
