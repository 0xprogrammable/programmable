# Proposal

**Stage:** architecture review

**Model id:** `long-game-v1`

**Exact review envelope:** `6ff54ae2d8202d889176bb60ec44e99f602fa68d`

**Reviewed executable baseline:** `67512e3b7ea1cff4e214d31c209816278b374c5d`

Long Game is an immutable Uniswap v4 hook system for custodied, non-transferable cost-basis positions. Verified exact-input buyers receive withdrawable positions backed by actual V4 output held by the hook. Verified sellers recover the sell-side project fee except for a maturity-decaying share of actual profit; that penalty rewards mature shares owned by other holders.

## Canonical pool and launch

The launch is bound to Ethereum mainnet, canonical PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90`, existing Programmable V4 `0x7987f03462200b3D8A072E02C89A8A41dCB124EE` as currency0, and canonical WETH9 `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` as currency1. Both assets use 18 decimals. V1 does not deploy a token, mint supply, define new metadata, or construct a dynamic PoolKey. The exact fixed PoolKey uses fee `3000`, tick spacing `60`, and permission-mined hook `0x5B3158d8aDdEa575827b4d8F2a0C9Db2433120CC`; its PoolId is `0x21046f95cb42b61b492b11d2573f32e79c8d2dd6169a4da14cb1a7adf75faec7`.

The executable `launch.json` uses the canonical deterministic deployment proxy, root salt `0xb2390533357720983da2b44ebeca43bce87e5f5a7b3d5a79fc898b760f7b926a`, and predicted launcher `0x38FD7904d32C7dd227E34bBe2b1A34a0720A4a5E`. The launcher constructor creates the authenticated router first and hook factory second. Its one-shot initializer requires the launch-session wallet to be both caller and payer before any transfer, deploys the hook with the exact permission salt, registers and initializes the canonical pool at `sqrtPriceX96 = 62483982636359169950086397`, pulls capped V4/WETH from that wallet, adds the declared full-range liquidity, settles both PoolManager deltas, and returns deterministic rounding remainders. Any mismatch reverts the entire transaction.

The launcher permanently owns the initial v4 core position. It has no decrease-liquidity, fee-collection, rescue, arbitrary-call, owner, or upgrade surface, so the initial position cannot be removed through project code.

## Hook behavior and economics

The hook enables exactly `beforeInitialize`, `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, and `afterSwapReturnDelta`, matching mask `0x20cc`. Empty hook data preserves permissionless ordinary routing. Verified flows require the immutable `LongGameRouter`, exact-input execution, and a staged single-use intent binding owner, position, direction, amount, price limit, minimum output, deadline, and nonce.

Buy swaps select 10 bps total: exactly 10 bps to Programmable and zero project fee. Sell swaps select 300 bps total: exactly 10 bps to Programmable and at most 290 bps project fee. The Programmable entitlement is immutable and claimable only by `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. Platform and project components have independent cumulative rounding streams and cannot be redirected or swept.

Position owners may withdraw V4 at any time without a fee. A verified sell destroys proportional cost basis. Its project component is rebated except for a maturity-decaying penalty on actual profit; the penalty is zero after 30 days, on a loss, or when no other eligible holder exists. There is no project treasury, mutable rate, pause, blacklist, upgrade, transfer tax, arbitrary call, or admin recovery path.

## Evidence and boundary

The exact review envelope publishes an attributable Codex semantic review, a canonical compiler/dependency/artifact manifest, and a successful exact-head GitHub Actions witness. That witness reproduced 65 passing Foundry tests across four suites, four stateful invariants with 8,192 calls and zero handler reverts, production contract-size checks, the pinned mainnet-fork launch and real PoolManager settlement rehearsal, and the classified Slither 0.11.4 result. The executable source, tests, launch scripts, specification, package lock, and explicit remappings remain byte-identical to baseline `67512e3b7ea1cff4e214d31c209816278b374c5d`.

The Codex record covers the requested swap, authorization, settlement, custody, accounting, rollback, permanent-liquidity, claim, exit, and failure paths and dispositions. It is an automated review, not a third-party human audit, acceptance, deployment, source/runtime verification, routing approval, security guarantee, or availability claim. Maintainer verification of the exact record and hashes remains open. Quoting, indexing, monitoring, registry integration, routing-provider work, and final signed verification remain separate gates.
