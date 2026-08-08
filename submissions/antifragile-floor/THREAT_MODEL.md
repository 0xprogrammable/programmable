# Threat model

Adversarial threat review of `src/AntifragileFloorHook.sol`, `src/AntifragileLauncher.sol`, `src/AntifragileToken.sol` and `src/lib/FloorMath.sol`, backed by 88 passing tests (`forge test --no-match-path "test/fork/*"`, 0 failures) plus a mainnet-fork suite. Nothing here is a substitute for independent review by the maintainers.

## Threat surface

- First-pool binding capture. The hook precommits the exact token, start price and tick spacing at construction; `afterInitialize` reverts `WrongToken`, `WrongStartPrice` or `WrongTickSpacing` for any other pool and `PoolAlreadyBound` on any second initialization, so a front-runner cannot capture the hook with a foreign pool. Tests: `test/audit/BindingFrontrun.t.sol` (the front-run reverts and the intended pool still binds) and `test/HardValues.t.sol`.
- Reserve drain via partial fill. The floor top-up is sized on the EXECUTED token the pool received, read from the swap delta, never the requested amount, so a tight-price-limit partial fill that delivers only dust cannot be over-subsidised. Regression: `test/ReserveDrainExploit.t.sol` (the drain that once extracted the reserve for dust now extracts nothing beyond fair value).
- Dust and partial-fill accounting. A one-wei quote-specified exact-input swap whose fee consumes the entire input reverts `DustNoAmmLeg`; a before-quadrant price-limited partial fill that would overcharge the executed quote reverts `PartialFillNotSupported`. Tests: `test/HardValues.t.sol` and the quadrant coverage in `test/ProgrammableFee.t.sol`.
- Floor manipulation via token supply. `backedSupply` is an immutable snapshot taken once at bind time, never a live `totalSupply()` read, so a mintable, burn-anyone or rebasing token cannot move the floor after init. Tests: `test/audit/TokenModel.t.sol` (mint, admin burn-anyone and reverting-supply cases).
- Solvency. The hook holds exactly `reserveQuote + programmableFeeOwed` in ERC-6909 quote claims; the top-up is capped by `reserveQuote`, so it can never pay out more than it holds. Invariant: `test/invariant/AntifragileInvariants.t.sol::invariant_*` and the drain handler in `test/invariant/AntifragileDrainInvariant.t.sol`.
- Owner and reserve isolation. The owner's only lever is `claimProgrammableFee`, which touches the platform liability only and can never reduce the reserve; symmetrically the top-up burns only the reserve and leaves the liability fully payable. Tests: `test/audit/OwnerReserveIsolation.t.sol`.
- Reentrancy. All swap-path work runs inside the PoolManager unlock; `totalSupply()` is never on the swap path (the floor reads the frozen snapshot), the floor read is a STATICCALL, claims are zero-before-pay, and a nested `unlock` reverts. Tests: `test/Reentrancy.t.sol` and `test/audit/ReentrancyDeeper.t.sol`.
- Fee bypass. The mandatory fee is collected in all four quadrants on the executed basis; fragmenting a swap ceils each piece independently, so fragmentation only ever pays more, and an ERC-6909 donation to the hook is inert and unstealable. Tests: `test/audit/FeeBypassAndAccounting.t.sol`.

## Real-infrastructure evidence

`test/fork/AntifragileFork.t.sol` brings up the hook against the real mainnet PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` (identity by codehash), binds a canonical pool and checks mandatory-fee accrual, the floor top-up and solvency against real infrastructure.
