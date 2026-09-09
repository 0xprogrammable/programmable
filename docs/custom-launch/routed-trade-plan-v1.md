# Generic vNext routed swaps

The new `POST /api/custom-launch/vnext/trade/prepare` endpoint reads an already
finalized `custom_launch_plan_v1` projection from the existing Robinhood index.
It builds one exact-input Uniswap V4 swap for a declared market. It never changes
the legacy V2 trade endpoint, legacy fees, hook lists, or Ethereum routing.

`LaunchPlanTradeRequestV1` and `LaunchPlanTradePreparationV1` in
`lib/custom-launch/routed-trade-plan-v1.ts` are the wire types. A request fixes
chain `4663`, launch ID, plan hash, market ID, connected account, direction, raw
input amount, slippage, deadline and exact hook data. Pool keys, router addresses,
fee rate and fee recipient are selected from the saved projection and frozen
infrastructure binding, never from request-selected commands.

The routed fee policy `programmable.routed-swap-fee.v1` uses:

- `SWAP_EXACT_IN_SINGLE`, then `SETTLE_ALL` for at most the requested input;
- `TAKE_PORTION(outputCurrency, 0xD88539d3c4C460136a733A3Fd60cf6BF269079da, 20)`;
- `TAKE_ALL(outputCurrency, netMinimum)` and an exact native-input refund sweep.

The fee is `floor(gross output credit * 20 / 10000)`, in the output asset, once
inside the same PoolManager unlock. There is no charge for preparing a launch,
no percentage on gas, and no fabricated swap for a launch without a market.
No-market/no-swap projections retain `not_applicable` and zero swap fees.
External routers and direct pool interactions can bypass this routed fee.

A normal getter or a successful call never proves immutable pool enforcement.
The shared `immutable-pool-fee-runtime-custom-launch-plan-v1` verifier rebuilds
the existing reviewed NativeFeeKernel, Native20 combined and BLOB fee-controller
runtime property proofs from their original compiled artifacts. It checks every
runtime byte, repeated immutable, exact PoolKey, fixed recipient, fee vault and
controller relationship. The browser and server hold identical generated recipes
and independent vectors. Serialized certificates are reconstructed through this
verifier; a caller-shaped object cannot select the zero-routing-fee branch.

When both current providers match every required runtime, the adapter reuses the
existing `pool_enforced` fee and omits `TAKE_PORTION`. That fee is 20 bps of the
gross native leg, rounded up per trade, accrued as a backed native claim in the
immutable fee vault and claimable permissionlessly to the fixed recipient. Each
prepared swap must also prove its exact callbacks, vault accrual and PoolManager
ERC-6909 backing before and after execution. A recognized fee implementation with
an unavailable or changed child runtime stays pending. Unrecognized mechanisms
use the normal 20 bps routed path without a source category or hook-name gate.
The proof covers the exact PoolKey only; it never claims universal `all_routes`.

The production transport requires a configured dRPC endpoint and an independently
configured Alchemy endpoint. It reads `ROBINHOOD_V4_RPC_PRIMARY_URL` and
`ROBINHOOD_V4_RPC_SECONDARY_URL`; the website aliases `ROBINHOOD_RPC_URL` and
`ROBINHOOD_SECONDARY_RPC_URL` are accepted only for the same reviewed endpoints:
`https://lb.drpc.live/robinhood/<credential>` and
`https://robinhood-mainnet.g.alchemy.com/v2/<credential>`. Their canonical trust
domains remain `drpc.org` and `alchemy.com`. TLS, host, credential path, no query,
no port, no userinfo and no fragment are enforced. If supplied, the corresponding
`_PROVIDER_ID`, `_TRUST_DOMAIN`, and `_AUTHENTICATION` metadata must match `drpc` /
`alchemy`, those trust domains, and `provider-credential`. Public fallbacks do not
qualify. Provider credentials and upstream errors are excluded from responses.

Both providers must agree on chain, current canonical checkpoint, infrastructure
and component runtimes, quote, exact `eth_call`, gas estimate, call trace and
trace-derived poststate. The server verifies the router's actual successful
PoolManager `take` calls and independently reads recipient balances before and
after the simulated transaction. Output transfer accounting that differs from the
declared credit requires an exact settlement adapter; no project name, economic
category, tag or hook catalog determines eligibility.

The public status has distinct meanings:

- `ready`: the exact current swap, output credits and either the routed fee
  transfer or the existing pool fee's backed accrual were simulated;
- `approval_required`: only an exact bounded ERC20 or Permit2 approval is prepared;
  there is no successful swap claim;
- `analysis_pending`: an independent observation or required execution adapter is
  unavailable. A provider outage is never called an unsafe economic model;
- `TRADE_EXECUTION_REVERTED`: both providers returned the same failing call trace.

The first-party wallet callback obtains a fresh preparation, reconstructs every
command, rechecks the connected chain/account and runtime code, and uses the
existing session and cross-tab request lock. Contract wallets must expose their
actual controller account. Their logical call omits the EOA nonce and explicitly
does not prove owner approvals or the final outer-transaction gas cost.

`evidence.feeTransfer` binds the actual output credit, routed fee, trader credit,
recipient balance changes and trace/poststate digests. Its scope is one exact
simulated transaction. Distribution adapters may only use `ready` with this
complete evidence as a bounded routing observation; quoter success or an
approval alone is insufficient.

For `pool_enforced`, `fee.poolEnforcementWitness` contains the reconstructed
source property proof and `evidence.runtimeBindings` contains every fresh
runtime observation. `evidence.feeTransfer.poolFeeAccrual` additionally binds
the native PoolManager delta; gross native amount; platform, creator and backing
balances before and after the simulated transaction; their exact increases;
and callback/record trace digests. The platform increase must equal
`ceil(grossNativeAmount * 20 / 10000)` and the backing increase must exactly cover
both new liabilities, with solvency before and after the trade. Separate creator
or token taxes can change net output and are not reclassified as platform fees.
The wallet helper reconstructs the canonical command bytes and rereads every
runtime binding before invoking the connected wallet. The review displays the
included native pool fee separately from the zero additional route fee.

Local validation includes the existing Uniswap V4Router and PoolManager code:
actual native-to-token and token-to-native payouts, atomic rollback when the net
minimum fails, and 256 fuzz cases. The shared SDK vector is checked in TypeScript
and executed by `contracts/test/RoutedSwapFeeVNext.t.sol`. These tests are local
execution evidence, not a live Robinhood swap, provider certification, wallet
signature, deployment, or public release.

The pool reuse tests reconstruct all three exact source/runtime proofs and cover
both swap directions, funded accrual, absent records and child code, underpayment,
unbacked liabilities and forged certificates. Their RPC traces and poststates are
local deterministic fixtures, distinct from the actual local V4Router execution
tests and from production provider or onchain evidence. The backend recipe
generator is `services/custom-launch-api-v1/scripts/generate-immutable-pool-fee-recipes-custom-launch-plan-v1.ts`;
its `--check` mode verifies the shared recipes against the original artifacts.
