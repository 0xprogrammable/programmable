# Proposal

## Outcome

Overtime v1 is a recurring leader-time game implemented as one fee-enforcing Uniswap v4 hook. An opt-in exact-input WETH buy takes the crown. Ordinary swaps pay the same hook-owned fee but never change the leader or clock.

The proposal is bound to source commit `a9bc79e377da73e336157df6e3ab1ca842092ec2` and tree `dd434971d1d5246ce1907891c34ef27b059a9ce2` in repository id `1326198143`.

## Game

The first valid challenge starts a round with a 15-minute soft deadline and a fixed 60-minute hard deadline. Each later challenge extends the soft deadline to the lesser of the hard deadline and the greater of the existing deadline or five minutes after the challenge.

A challenge requires at least 0.01 WETH of actual settled quote volume. It pays the ordinary 110-basis-point hook-owned fee and a crown cost equal to the active pot times 100 basis points, clamped between 0.001 WETH and 0.10 WETH. This design tweak improves balance while keeping the gross WETH buy floor unchanged. A same-block displacement credits the displaced challenger contribution to a pull-based refund.

At a soft-deadline knockout, 40 percent goes to the champion, 50 percent is distributed by crown-seconds, and 10 percent rolls over. At the hard-cap decision, no champion bonus exists, 90 percent is distributed by crown-seconds, and 10 percent rolls over. Claims and refunds are pull-based without an administrator redirect path.

## Fee kernel

The hook calculates liabilities from actual settled WETH. Exactly 10 basis points of gross quote volume accrue to the Programmable liability and 100 basis points accrue to the game liability. The implementation covers exact-input buys, exact-output buys, exact-input sells, and exact-output sells. Empty hook data selects ordinary mode; authenticated challenge mode accepts only exact-input WETH-to-token buys and rejects partial fills atomically.

Programmable fees, pending-pot funds, active-pot funds, finalized champion pools, finalized crown-time pools, same-block refunds, and claimed amounts remain separate accounting domains. Available funds are not inferred from the hook's raw WETH balance.

## Contracts and custody

The source contains the seven requested implementation units: `OvertimeHook.sol`, `OvertimeChallengeRouter.sol`, `OvertimeToken.sol`, `OvertimeLauncher.sol`, `LockedLiquidityVault.sol`, `RoundMath.sol`, and `HookDataCodec.sol`.

The launch route deploys the immutable challenge router and launcher roots, then calls one atomic launcher entrypoint. The launcher deterministically creates the fixed-supply token, hook, and locked-liquidity vault; initializes the canonical WETH pool; and transfers the initial position claim into the vault in the same transaction. Any failed initialization or liquidity-lock step reverts the entire child deployment graph.

There is no owner sweep, WETH or game-token rescue, pause, parameter setter, payout redirection, arbitrary router call, post-deployment mint, or removable initial-liquidity path.

## Launch-input binding

The launch-session wallet is an expected creation-time input. The launcher rejects any starting price other than `792281625142643375935439503360000` and any WETH budget other than `10000000000000000000` base units. Token and hook creation bytes are constrained by immutable hashes. Only the ordered-token salt and permission-mined hook salt remain launch-authority-selected because their values depend on the wallet-derived launcher graph.

After those salts are selected, the production preflight must ABI-encode the complete `deployAndLaunch` call and bind `keccak256(abi.encode(chainId, sender, target, valueWei, keccak256(calldata)))`. The wallet sees and manually confirms the exact sender, Ethereum chain, derived launcher target, zero value, full calldata hash, token, hook, and mask `0x20cc`. A changed field requires a fresh simulation and confirmation.

The package remains `architecture-review-required` because public intake is a proposal-stage preflight and does not grant execution authority, not because the launch inputs are unclassified.

## Requested assessment

Assess the exact source and evidence bindings, the `beforeSwapReturnDelta` fee signs across all four ordinary quadrants, challenge settlement authentication, liability conservation, deterministic address graph, and permanent initial-liquidity custody. This submission does not request deployment authority and does not claim an audit, endorsement, or launch.
