# Proposal

RELICS is a fully on-chain generative art collection whose Uniswap v4 hook turns real market
history on one canonical $RELICS/WETH pool into permanent visual condition. The system has been
operating on Ethereum mainnet since 2026-08-03; the deployment dates to that day and every
contract identity in this record is publicly verifiable on-chain. This application publishes
the exact hook source as an explicitly authorized public flagship reference and asks for
architecture review of that record. It is not a request to launch anything new.

## What the hook is

- An observer bound one-shot to a single canonical pool: $RELICS (currency0) / WETH
  (currency1), fee 3000 (0.30% static LP fee), tick spacing 60.
- Exactly three callbacks are enabled — afterInitialize, afterAddLiquidity, afterSwap —
  encoded as 0x1440 in the address itself. No before-hooks, no donate hooks, no return-delta
  permissions: the hook records swap and liquidity history into one packed GlobalMarketState
  and structurally cannot alter, tax or refuse a trade.
- Every callback revalidates the full PoolKey and reverts UnauthorizedPool for any other pool,
  so a second pool cannot even initialize against it.
- owner() is address(0). The one-shot bindCanonicalPool authority was spent before renouncing;
  no proxy, pause, upgrade, allowlist, tax switch or admin exists anywhere in the system.

## Where the exact source lives

The flagship/ directory of the primary repository holds the complete standard-JSON compile
closures of all four contracts — hook, token, NFT and renderer — a fifty-eight-file union,
byte for byte identical to their Etherscan-verified inputs, together with the pinned compiler profile (solc 0.8.26, optimizer runs 1,
via-IR, cancun, no metadata hash) and an offline proof: flagship/test/DeploymentProof.t.sol
recompiles the tree and reproduces the recorded init-code hash, the CREATE2 derivation and the
permission bits. Machine-readable provenance is in flagship/PROVENANCE.json. The repository
root is a separate clean-room starter template; the two share no code.

## Value flows and fees

The only fee anywhere is the pool's 0.30% LP fee to liquidity providers through core v4
accounting. The hook collects nothing, holds nothing, and has no recipient. Genesis liquidity
was single-sided (all 10,000 $RELICS, zero seeded WETH); there was no mint price, no presale,
no team allocation, and no project-funded first trade.

## Mandatory Programmable fee

Not integrated, and not integrable in place: the described hook is immutable and ownerless, so
programmableFee collection remains pending-hook-integration permanently for this instance. A
fee-integrated variant would be a new deployment with its own source, tests and review. Whether
that variant is in scope for this application id is an open maintainer decision recorded in the
compatibility report.

## One disclosed token behavior

The paired ERC-20 couples outflows to an NFT dormancy layer: transfers retire the sender's
awakened Relic NFTs (LIFO, real burn events) so active NFTs never exceed whole-unit balance,
bounded at 16 retirements per transfer. A larger unprepared transfer reverts
PreparationRequired until the holder — msg.sender only — calls prepareSell. Amounts are never
modified, buys are never affected, and no operator path exists. This is the strongest-label
disclosure, not a hidden control. Following maintainer review, the token and NFT sources are
now bound byte-exactly in the flagship closure and a dedicated eleven-test seller-exit suite
(flagship/test/TokenNftSyncExit.t.sol) proves ordinary transfers, 0/1/16/>16 retirements,
holder-only batch preparation, complete exit with no third-party involvement, allowance
paths and atomic failure against those exact sources.
