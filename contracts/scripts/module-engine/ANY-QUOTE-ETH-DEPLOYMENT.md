# Any Quote with per-trade ETH fee settlement

The native-fee source is `module-engine-any-quote-eth-v1`, with engine profile
`robinhood-any-quote.shared-hook.native-eth.v1`. The earlier quote-fee source and its
evidence remain separate.

`any-quote-eth-prepare.mjs --parameters FILE --output DIRECTORY` seals the clean
source and prepares two unsigned transactions. The parameter file contains
`owner`, `ownerNonce`, `reviewAuthority` and `releaseLabel`.

1. At owner nonce N, the deterministic deployer creates `AnyQuoteEthSharedHookV1`
   with CREATE2. Its constructor binds the future Host address and creates its
   first child, `AnyQuoteEthLedgerV1`.
2. At nonce N+1, the same owner creates `ModuleEngineAnyQuoteEthHostV1` directly.
   Its eight constructor arguments bind the predeployed hook and full runtime
   hash, existing Registry, token factory, launch policy, PoolManager, reward
   administrator and retained route guard.

The guard at `0x92c1d5735a89488a77841634c48d922cd3f2c0e4` is retained from source
`9824c23ca4954fde8b5f4861f2a537fd0600bbf7`, release `ac96`. Its source evidence and
complete source closure are bound independently from the earlier native V1
Registry, factory and policy. No guard deployment or state migration is needed.

The existing `module-mode/operator.mjs` selects this exact plan schema and keeps
its original source authority, fee ceilings, reserved nonces, wallet handoff and
durable no-resend journal. A source-only continuation cannot change either
historical dependency source, any constructor bytes or economic rights.

Use `any-quote-eth-collect.mjs` for `observe`, `record`, `deployment`,
`source-requests` and `source`. The `source` command requires both
`--previous-source FILE` for the native V1 evidence and
`--previous-guard-source FILE` for the exact earlier guard source evidence.
Actual deployment records, verified creation lineage and full source readback
are required. A successful collection does not assert chain finality or public
activation.

The preactivation packet schema is
`programmable.module-engine-any-quote-eth-preactivation-packet.v1`. It adds
`previousGuardSourceVerificationEvidenceRaw` to the original packet fields.
Native lifecycle plans require a positive initial ETH purchase, use
`claimEthTo(recipient)` for payout, and preserve source-bound minimum outputs and
exact finite sell allowances. Lifecycle references are:

- `native-fee-pool-swap`: `transactionHash`, `logIndex`, `poolId`, `buy`.
- `native-eth-claim`: `transactionHash`, `logIndex`, `beneficiary`, `recipient`.

Supply the actual positive creator and platform ETH claim receipts. Pool quote
asset identity remains the chosen ERC20; fee settlement is native ETH. The
canonical `FeeHop[]` bytes are committed in signed launch data and must match the
route getter and `NativeFeeRouteBound` event preceding pool initialization.
