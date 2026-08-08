# Threat model

## Assets and liabilities

The primary assets are WETH held for Programmable fees, the pending next-round pot, the active pot, finalized champion and crown-time pools, same-block refunds, and unclaimed payouts. The game token and the permanently held initial Uniswap v4 position are additional custody assets.

Each liability domain is explicit. Solvency checks compare accounted custody with unpaid liabilities; they do not treat an unsolicited token transfer or the raw WETH balance as distributable value. Claims mutate only the caller's earned liability and cannot be redirected by an administrator.

## Trust boundaries

The hook accepts callbacks only from its immutable PoolManager and only for its immutable canonical PoolKey. BaseHook authentication remains in the callback path. Empty hook data is ordinary trade mode.

Challenge intent requires the immutable `OvertimeChallengeRouter` as callback sender. The router binds payer, player, and beneficiary to `msg.sender`; the hook does not trust an arbitrary address encoded in hook data. Challenge mode accepts only exact-input WETH-to-token buys and compares eligibility with actual settled WETH.

The selected Uniswap v4 PoolManager, WETH, PositionManager, Permit2, Universal Router, and Programmable release module are external dependencies. Their exact chain identities and injection points are declared in `launch.json` and must be resolved by the admission service.

## Adversarial swaps

An attacker may choose any supported ordinary swap quadrant, extreme specified amounts, price limits, or malformed hook data. Fee signs are derived from actual PoolManager deltas for the quote currency. Ordinary trades cannot mutate the leader or timer. Malformed nonempty data and unauthenticated challenge callbacks revert.

A challenge that settles below 0.01 WETH, settles in the wrong direction, uses exact output, or partially fills reverts atomically. This prevents a caller from acquiring the crown using requested volume that never settled. Ordinary fees, gas, and slippage are not refundable.

## Timing and ordering

Block timestamps define crown-seconds and deadlines. A block producer can influence timestamp within consensus bounds, so boundary tests cover equal-to-deadline and hard-cap cases. The hard deadline is fixed at round start plus 60 minutes. The soft deadline can only stay constant or advance and cannot pass the hard deadline.

Every swap first processes expiration. A post-expiry challenge therefore cannot resurrect the past round and instead may start a new one after finalization. Fees received after finalization go to the pending pot rather than the prior champion.

If a challenger is displaced in the same block, the displaced crown contribution becomes a pull-based refund. The previous holder's ordinary trade fee, gas, and slippage remain spent. Repeated challenges by the same address pay the normal cost and do not bypass accounting.

## Reentrancy and external calls

The hook follows PoolManager callback and unlock boundaries and updates claim liabilities before WETH transfer. The router exposes only its fixed challenge operation and cannot make arbitrary calls. The launcher makes the intended external initialization, mint, and transfer calls inside one atomic transaction; a failure reverts the complete child graph.

Static analysis flags external-call reentrancy surfaces around launcher orchestration. The source has no reusable partially initialized launcher state, and rollback tests assert that failed atomic execution leaves no child code or launch record. Review must still inspect each external dependency and callback assumption at the exact pinned revisions.

## Governance and custody constraints

There is no upgradeability, owner sweep, WETH or game-token rescue, pause, mutable parameter, payout redirection, blacklist, transfer tax, post-deployment mint, oracle, randomness source, or keeper dependency. The initial position claim moves to a vault with no withdrawal method.

These omissions deliberately remove operator recovery powers. Accidental transfers may be unrecoverable, and a defect cannot be paused or upgraded. Users and reviewers must treat immutability as both a product invariant and an operational risk.

## Launch-input risk

The launch-session wallet is selected at creation time. The launcher CREATE2 address depends on that wallet and root salt; the token, hook, vault, and canonical PoolKey then depend on the launcher and the two authority-selected child salts. A wrong wallet, salt, compiler artifact, dependency address, or hook-address permission suffix invalidates the launch graph.

The contract itself rejects alternate starting prices and WETH budgets and rejects creation-code hash drift. The final preflight must classify the two child salts as authority-selected, derive every address, confirm token ordering and hook mask `0x20cc`, ABI-encode the complete call, and bind sender, chain, target, zero value, and calldata hash before a fresh simulation and manual wallet confirmation. The package reports proposal-stage architecture review and makes no deployment, audit, safety, or endorsement claim.
