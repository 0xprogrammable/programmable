# Test plan

This is a proposal-stage record for an artifact that already exists on-chain; the plan
separates checks that anyone can reproduce from this repository, existing external evidence,
and checks that would only apply to a future fee-integrated variant.

## Reproducible from the primary repository

- Seller-exit behavioral suite: flagship/test/TokenNftSyncExit.t.sol wires the exact
  production token, NFT, renderer and hook sources together (the hook constructed at a
  flag-valid address so its permission validation runs for real) and proves ordinary
  transfers, inflow-never-mints, 0/1/16/>16 retirements, LIFO order, the exact
  PreparationRequired quote with atomic unwind, holder-chosen preparation followed by a
  complete exit with no third-party involvement, holder-only preparation against a full
  operator plus allowance, sender-only capacity-bound awakening, allowance-driven
  transferFrom, and batch bounds — eleven tests, all passing — plus a token CREATE2 proof
  reproducing the recorded token address from this exact source.
- Offline deployment proof: cd flagship and run forge test with the pinned profile
  (solc 0.8.26, optimizer runs 1, via-IR, cancun). Four tests assert byte-exactness: the
  abi-encoded constructor arguments equal the recorded bytes, the init-code hash equals the
  recorded mined value, the CREATE2 derivation lands on the recorded contract address, and the
  address bits encode exactly the three declared permissions. Any changed source byte or
  compiler setting fails the suite.
- Template regression: at the repository root, forge build and forge test run 62 tests across
  10 suites against the same production-pinned vendored dependencies (v4-core 1.0.2,
  uniswap-hooks 1.2.2, OpenZeppelin 5.6.1, v4-periphery 1.0.3, solmate, permit2, forge-std).
- Deterministic Builder v0.2.1 preflight: the committed builder-repository package under
  submissions/relics-v4/ carries the generated compatibility report with a complete Solidity
  closure over the declared flagship paths.

## Existing external evidence

- Etherscan source verification of the hook, token, NFT and renderer at their recorded
  addresses with the exact compiler profile; the fifty-eight-file flagship closure is
  byte-identical to the union of their verified standard-JSON inputs.
- Public chain reads reproducible with any RPC: runtime code hash 0xd45977dd, code size 8644
  bytes, owner address(0), canonical pool id 0x33d9b408, fixed 10,000e18 total supply.
- The private production pipeline ran unit, integration, fuzz, invariant, reentrancy,
  differential and fork suites plus release gates before 2026-08-03; stated as provenance,
  not bound as beta evidence.

## Applicable only to a future fee-integrated variant

A new deployment integrating the mandatory volume fee would require the full prototype
battery: fee vectors for the 10 bps floor and non-additive split across all four executed
swap modes, quadrant-dependent gross quote-side basis, callback-skipping self-calls,
immutable owner-only claims with per-claim destinations, non-bypassability, no cross-pool
netting, plus fuzz, invariant, static-analysis and fork evidence and a fresh permission-mask
and CREATE2 plan for the new address. None of that can apply to the immutable instance this
record describes.

## Known limitations

- The flagship suite proves byte-exact identity with the recorded artifact; behavioral
  evidence for the running system lives in the external record above.
- No fork tests run in the public repository's CI because it carries no RPC secrets; the
  fork smoke test skips cleanly when MAINNET_RPC_URL is unset.
