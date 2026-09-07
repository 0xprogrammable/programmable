# MultiRole V2 runtime data policy V1

`ProgrammableMultiRoleLaunchStampRouterV2DataPolicyV1` is an additive, undeployed Router implementation for
`programmable.runtime-instructions.reachable.v1`. It accepts provably nonexecuting compiler data while retaining
the runtime prohibition on potentially executable `CALLCODE`, `DELEGATECALL`, and `SELFDESTRUCT`.

The policy identifier is `0x8c050833f80693e4bf758bd93eea585a1f41892c4fcc9fa0282f0af84ed772b4`.
The getter is descriptive: a contract that returns that identifier is not thereby trusted. Admission must bind the
exact reviewed Router creation/runtime, deployment address, chain, permit authority, graph factory and PoolManager.

## Rule and execution model

The rule applies only to legacy EVM bytecode. A nonempty runtime beginning with `0xef` is rejected as
`UnsupportedRuntimeMode(targetIndex)`, covering the reserved prefix, EOF containers and delegation designators.

1. Decode all bytes from program counter zero, skipping the immediate bytes of every `PUSH1` through `PUSH32`,
   including pushes in regions that cannot execute. A truncated push still consumes its whole immediate width.
2. Treat program counter zero and every decoded `JUMPDEST` as a potential execution entry. No stack or jump-target
   inference is required, so both constant and dynamic jumps are covered.
3. `STOP`, unconditional `JUMP`, `RETURN`, `REVERT` and explicit `INVALID` end sequential execution. Continue
   decoding the remaining bytes to discover all subsequent valid entries. `JUMPI` retains its fallthrough path.
4. Reject a forbidden instruction at a potentially executable program counter, preserving the existing target-index,
   program-counter and opcode error. A forbidden opcode is checked before any reachability update could hide it.
5. Treat other undefined opcodes conservatively as fallthrough. Neither metadata suffixes, `0xfe` alone, event topics,
   caller offsets nor claimed compiler data boundaries authorize skipping a region.

Empty runtime is harmless to the instruction-only helper, but the enclosing Router already rejects a deployment
with empty code. The backend additionally applies its existing nonempty/EIP-170 length gate before scanning.
Recognizing data does not waive code-size limits or any graph, runtime-hash, permit, initialization or economic gate.

## Why the excluded regions cannot execute

For legacy EVM, execution begins at program counter zero. Every later instruction is reached either by the previous
instruction's sequential successor or by a jump to a globally valid `JUMPDEST`. The EVM computes that validity by
decoding the entire byte stream and excluding `PUSH` immediates. The scanner uses those same boundaries.

By induction over an execution trace, each actually reached instruction is in a scanner region marked potentially
executable: zero is included; a sequential successor remains included unless the previous instruction cannot fall
through; and every valid jump destination starts an included region. Consequently no actually executable forbidden
instruction can be ignored. Considering every valid destination, including unused ones, can still cause conservative
rejection; the policy deliberately makes no full-program reachability claim.

The execution rules are documented by Ethereum's
[legacy jump-destination analysis](https://github.com/ethereum/execution-specs/blob/master/src/ethereum/forks/cancun/vm/runtime.py)
and [control-flow instructions](https://github.com/ethereum/execution-specs/blob/master/src/ethereum/forks/cancun/vm/instructions/control_flow.py).
This argument does not apply to a different bytecode mode, future execution semantics, constructors, separately called
contracts, initialization behavior, or economic invariants. Those remain independent source and simulation checks.

## Compiler-data regression

Solc 0.8.26 can place the ERC-20 `Transfer(address,address,uint256)` topic in a runtime data segment. The committed
43-byte Yul fixture copies its 32-byte topic using `CODECOPY` and returns it. The original V2 scanner rejects byte 12
as `CALLCODE`; the successor accepts the data, and an EVM call returns the exact expected topic.

This fixture reproduces the scanner defect. It is not the BLOB source, a verification of BLOB's reported optimizer
sweep, or admission of its burn, distribution, bounty and liquidity mechanisms. The policy never whitelists that topic:
the same bytes beginning at an executable program counter remain rejected.

## Compatibility and release boundary

The original `ProgrammableMultiRoleLaunchStampRouterV2` retains its linear scanner. Its only source change is marking
the internal scanner `virtual`. Under the pinned solc 0.8.26, Cancun, optimizer 1,000, metadata-free build, original V2
creation bytes and runtime-template bytes remain exactly identical to main commit
`446e18707d9080bd7a6ef059a51c9a9b6f5db6ca`; immutable slot locations also remain identical. Compiler AST ids are not
bytecode identities and can change when the source selection changes.

The successor reuses the V2 external launch ABI, commitments, EIP-712 version, role semantics and nonce rules. Its new
deployment address is part of the permit domain and stamp provenance. Old reservations, permits, stamps and historical
read/recovery contexts must retain their original Router and request bytes. A new context requires a newly packed
request; it must not silently reinterpret an existing request under this policy.

The successor must be separately reviewed, deployed and verified before an API context can select it. It has no upgrade
or migration authority over the old Router. This source change signs no deployment or launch, moves no funds and does
not activate public admission.

## Focused verification

The committed shared vectors are in
[`spec/runtime-instruction-policy/reachable-v1-vectors.json`](../../spec/runtime-instruction-policy/reachable-v1-vectors.json).
They cover live forbidden instructions, no-fallthrough data, reentry after every terminal, dynamic/backward jumps,
global `PUSH` boundaries, truncated pushes, compiler data, unsupported modes and explicit false-positive regressions.

The Solidity suite also executes the data reader, a `CALLCODE` path reached beyond `INVALID`, a caller-selected dynamic
jump beyond `RETURN`, and an invalid jump into a dead `PUSH` immediate. It tests every push width, every terminal/
forbidden-opcode combination, exact 24,576-byte deployment and the final valid `JUMPDEST` boundary. A two-pass entry-path
oracle checks generated byte streams independently of the production active-region flag. All 29 existing graph,
permit, rollback, replay, domain and stamp tests also run against the successor; the original tests remain active.

```sh
FOUNDRY_CONFIG=config/multi-role-router-v2/foundry.toml FOUNDRY_FUZZ_RUNS=10000 \
  forge test --match-path 'test/router_v2/*.t.sol'
FOUNDRY_CONFIG=config/multi-role-router-v2/foundry.toml forge build --ast --build-info --skip test
forge fmt --check src/router_v2 test/router_v2
git diff --check
```

The successor's pinned runtime template is 17,360 bytes, below EIP-170. Its template hash is not its deployed code hash:
the final runtime includes immutable values and must be independently reproduced for the actual deployment envelope.
