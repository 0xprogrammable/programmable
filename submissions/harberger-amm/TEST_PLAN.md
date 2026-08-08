# Test plan

`forge test --no-match-path "test/fork/*"` reports 77 tests with 0 failures on solc 0.8.26, cancun, optimizer runs 200 (viaIR off), across 12 suites. The toolchain is pinned by `compatibility.lock.json` (@openzeppelin/uniswap-hooks 1.1.1 + @openzeppelin/contracts 5.5.0, @uniswap/v4-core 1.0.2, @uniswap/v4-periphery 1.0.3, forge-std 1.9.3); fuzz runs 256, invariant runs 256 depth 30.

## Math and shares libraries

`test/HarbergerMath.t.sol` (11) — `taxOwed`, `isLiquidatable`, `accIncrement` and `pending`, including fuzzed monotonicity of the tax in elapsed time and a non-negative pending. `test/Shares.t.sol` (5) — pro-rata `toShares`/`toLiquidity` and a fuzzed round-trip.

## Permission scaffold

`test/HarbergerHook.t.sol` (3) — the mined hook address encodes exactly the mask `0x1acc`; `getHookPermissions()` returns exactly the seven enabled flags; the constructor stores the pool manager, tax rate, quote currency, fee configuration and owner.

## Custody and Harberger lifecycle

`test/Custody.t.sol` (6) — the custody gate reverts any non-hook add; deposit mints pro-rata claims and grows the position 1:1; a second deposit is pro-rata; withdraw round-trips the funds and burns the claim; over-funding refunds the dust; every path asserts `totalLiquidity == the real v4 position`, `Σ shares == totalShares` and no raw ERC-20 left on the hook.
`test/Tax.t.sol` (8) — the pre-paid deposit flows into reward-per-share; harvest pays; top-up extends; the liquidatable predicate; a 256-run solvency fuzz that `quote balance >= quoteTaxReserve == Σ taxDeposit + Σ pending`.
`test/Buyout.t.sol` (8) — buyout transfers ownership and reprices; the seller receives price plus reward plus leftover; a zero self-price is a free seize; the new owner can withdraw and the old cannot; the guards; a 256-run buyout solvency fuzz.
`test/Liquidation.t.sol` (8) — share-burn redistribution (each survivor's redeemable strictly rises while `totalLiquidity` is unchanged); the exact forfeiter payout; permissionless call; final-tax settle; the guards; a 256-run solvency fuzz.

## Mandatory Programmable fee

`test/Fee.t.sol` (13) — the platform slice is always 10 bps; the non-additive split; all four swap quadrants for quote as currency0 and currency1; the executed-not-requested basis under a price-limited partial fill; only the canonical pool accrues; `onlyPoolManager` entry points; owner-only claim to an arbitrary destination and a non-owner reverts; solvency with no cross-pool netting; the events reconcile; a fuzzed fee split.

## Parameter hardening

`test/ParamsHarden.t.sol` (9) — the `minSelfPrice` floor on deposit and buyout (reverts below the floor, accepts at the floor, disabled at zero) and `buyoutCooldown` (blocks an early buyout, resets on acquisition, disabled at zero), with a fuzzed floor and a fuzzed warp against a fixed cooldown.

## Atomic launcher

`test/HarbergerLauncher.t.sol` (3) — one `deployAndLaunch` deploys the token and the hook at their mined addresses, initialises the canonical dynamic-fee pool and seeds the custodied full-range position through the hook's own `deposit` (a real Harberger claim owned by the launcher); the launched coin is directly tradable and the mandatory fee accrues to the hook; a second call reverts `AlreadyLaunched`; a non-wallet caller reverts `NotLaunchWallet`.

## Adversarial and invariants

`test/audit/Reentrancy.t.sol` (1) — a malicious ERC-777-style quote token re-entering `withdraw` during its own payout is rejected by the `nonReentrant` guard; the attacker receives only its single legitimate payout and the baseline LP reserve is intact.
`test/invariant/HarbergerInvariant.t.sol` (2) — stateful invariants over a four-actor random interleaving of deposit, withdraw, buyout, liquidate, harvest, top-up, poke and warp: the reserve stays solvent (`quote balance >= quoteTaxReserve`) and custody stays synced (`totalLiquidity == the real v4 position`).
