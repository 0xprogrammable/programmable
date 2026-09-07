# Custom Launch analytics

[Public dashboard](https://dune.com/programmablehq/analytics) · [Dune query 8631499](https://dune.com/queries/8631499)

The dashboard refreshes every 24 hours. The query includes a finalized block and timestamp so readers can distinguish refresh time from the chain checkpoint.

`custom-launch-robinhood.sql` counts canonical V1 and V2 Launch Stamp Router events on chain 4663, including reference launches. It combines Dune history with a recent public RPC overlap, checks the chain and finalized head, and deduplicates logs by block hash, transaction hash and log index. RPC errors fail the query instead of supplying zero fees.

Fee events must come from a stamped hook and its exact pool at or after the launch block. Same-block initial-buy events can precede the stamp. An existence join prevents repeated launch references from multiplying fees. Module Mode fee events are excluded by launch provenance.

The query decodes `NativeFeesAccrued(bytes32,address,bool,uint256,uint256,uint256)`. Gross native amount, platform fee and creator fee are separate uint256 values in wei. Only display columns convert to ETH. Native20 platform fees equal `ceil(grossNativeWei * 20 / 10000)` per successful trade; the aggregate is the sum of emitted fees, not a rounded estimate from total volume. Creator rewards are separate from the platform fee.

Revenue is earned accrual, including unclaimed balances. Do not add `FeesRecorded` or `FeesClaimed` to it: they account for or withdraw the same fees. Gas, liquidity, donations and pool LP fees are excluded. Historical fee models without the supported event are outside the ETH totals. Add a separately verified event adapter before including another fee model or router.

Dashboard counters:

| Visualization | Column | Dune ID |
| --- | --- | --- |
| Custom Launches | `custom_launches` | 12648583 |
| Custom Creator Rewards | `creator_rewards_eth` | 12648604 |
| Custom Protocol Revenue | `protocol_revenue_eth` | 12648609 |

The title image is the supplied original at `public/brand/dune-analytics-title.png`.
