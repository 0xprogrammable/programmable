# Test plan

`forge test --no-match-path "test/fork/*"` reports 88 tests with 0 failures on solc 0.8.26, cancun, optimizer runs 200 (viaIR off), across 16 suites. The mainnet-fork suite is excluded here because it needs an archive RPC.

## FloorMath pure library

`test/FloorMath.t.sol` (13 tests). The floor-price ratio `reserveQuote * 1e18 / backedSupply`, ratchet monotonicity, zero-supply and zero-reserve edge cases, and rounding, exercised directly and under fuzzing.

## Mandatory Programmable fee

`test/ProgrammableFee.t.sol` (13 tests). The platform slice is always 10 bps; the non-additive split of the 30 bps effective rate; all four swap quadrants for quote as currency0 and currency1; executed-not-requested basis under a price-limited partial fill; only the canonical pool accrues; `onlyPoolManager` entry points; owner claims the platform liability and a non-owner cannot; solvency (hook ERC-6909 balance equals platform owed plus reserve); events reconcile; a fuzzed fee split.

## Self-funded floor

`test/FloorHonor.t.sol` (10 tests). A sell below the floor is topped up for both token orderings; a small sell above the floor uses the AMM only; partial honor when the reserve is smaller than the target; `floorHigh` stays monotonic across a mixed sequence; buys and exact-output sells are never topped up; a fuzzed solvency invariant with an owner claim; the fee basis stays the executed quote and is never charged on the subsidised gross.

## Atomic launcher

`test/AntifragileLauncher.t.sol` (3 tests). One `deployAndLaunch` deploys the token and the hook at their mined addresses, initialises the canonical dynamic-fee pool, seeds a full-range position, and the coin is directly tradable with the mandatory fee accruing solvently; a second call reverts `AlreadyLaunched`; a non-wallet caller reverts `NotLaunchWallet`.

## Reserve-drain regression

`test/ReserveDrainExploit.t.sol` (4 tests). The tight-price-limit partial-fill sell that used to drain the reserve for dust token now extracts nothing beyond fair value, single and looped, for both orderings, with an honest full-fill contrast — the top-up is sized on the executed token input.

## Hardened edge cases

`test/HardValues.t.sol` (14 tests). Zero-amount reverts; a one-wei quote-specified exact-input dust swap reverts `DustNoAmmLeg` (fee consumes the whole input, no AMM leg); near-max amounts; junk hookData; initialize-twice reverts `PoolAlreadyBound`; a non-quote pool reverts `NotQuotePool`; non-owner claim reverts; unknown-pool claim is a no-op; runtime bytecode under the EIP-170 limit.

## Adversarial suite

`test/audit/*` (15 tests). Binding front-run capture reverts `WrongToken` and the intended pool still binds (`BindingFrontrun.t.sol`, 3); fee fragmentation never under-charges and an ERC-6909 donation is inert and unstealable (`FeeBypassAndAccounting.t.sol`, 2); an owner claim never reduces the reserve and a drained reserve leaves the liability fully payable (`OwnerReserveIsolation.t.sol`, 3); a reentrant or reverting `totalSupply()` cannot brick swaps and claim payout follows checks-effects-interactions (`ReentrancyDeeper.t.sol`, 2); the floor is driven only by the immutable supply snapshot under mint, burn-anyone and reverting-supply tokens (`TokenModel.t.sol`, 5).

## Reentrancy

`test/Reentrancy.t.sol` (4 tests). A reentrant token as either side cannot drive a reentrant drain; callbacks are strictly `onlyPoolManager`; a reverting counterparty makes the swap revert atomically with no stuck state.

## Permission scaffold

`test/AntifragileFloorHook.t.sol` (3 tests). The mined hook address encodes exactly the mask `0x10cc`; `getHookPermissions()` returns exactly the five enabled flags; the constructor stores the pool manager, fee and quote currency.

## Stateful invariants

`test/invariant/*` (9 tests). Solvency and no cross-pool netting across fuzzed swap sequences (`AntifragileInvariants.t.sol`, 6); a dedicated drain handler cannot reduce the reserve below its accrued level (`AntifragileDrainInvariant.t.sol`, 1); two independent pools each stay solvent with no cross-pool custody (`AntifragileTwoPoolInvariant.t.sol`, 2).

## Mainnet fork

`test/fork/AntifragileFork.t.sol` (archive RPC, excluded from the 88 above). The real PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` is identified by codehash; the hook is brought up against it to exercise mandatory-fee accrual, floor behaviour and solvency against real infrastructure.
