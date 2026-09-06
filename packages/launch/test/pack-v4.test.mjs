import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import solc from "solc";

import { buildLaunch, packLaunch } from "../src/pack.mjs";
import { validateLaunchFile } from "../src/validate.mjs";
import { hashV4ChainDeployment } from "../src/v4-contract.mjs";
import { v4ChainDeployment, v4Profile } from "./fixtures/v4.mjs";

test("V4 pack builds and revalidates an exact 3-target Robinhood request without signing", async () => {
  const fixture = await materializeV4CompiledFixture();
  try {
    const first = await buildLaunch({ configPath: fixture.configPath });
    const outputPath = path.join(fixture.root, "launch.json");
    const receiptPath = path.join(fixture.root, "launch.receipt.json");
    const packed = await packLaunch({
      configPath: fixture.configPath,
      outputPath,
      receiptPath,
    });
    const validation = await validateLaunchFile({
      launchPath: outputPath,
      configPath: fixture.configPath,
    });

    assert.equal(first.request.schemaVersion, "programmable.custom-launch-create-request.v4");
    assert.equal(first.request.chainId, "4663");
    assert.equal(first.request.caip2, "eip155:4663");
    assert.equal(first.request.chainDeployment.chainDeploymentId,
      "robinhood-mainnet-custom-launch-v1");
    assert.equal(first.request.chainDeploymentDescriptorDigest,
      hashV4ChainDeployment(v4ChainDeployment));
    assert.equal(first.request.profile.profileRevision, 1);
    assert.equal(first.request.graphBundle.targets.length, 3);
    assert.equal(first.predictions.length, 3);
    assert.equal(first.request.funding.mode, "none");
    assert.equal(first.request.funding.valueWei, "0");
    assert.equal(first.request.liquidityModel.model, "none-empty-pool");
    assert.match(first.request.launchIntentHash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(first.request.agentAttestation.subjectLaunchIntentHash,
      first.request.launchIntentHash);
    assert.deepEqual(await readFile(outputPath), first.requestBytes);
    assert.deepEqual(await readFile(receiptPath), first.receiptBytes);
    assert.equal(packed.requestSha256, first.requestSha256);
    assert.equal(validation.requestSha256, first.requestSha256);
    assert.equal(validation.reproducedFromConfig, true);
    assert.equal(validation.exactSourceIncluded, true);
    assert.equal(validation.predictions.length, 3);
    assert.equal(first.receipt.apiVersion, "v4");
    assert.equal(first.receipt.package.version, "4.1.2");
    assert.equal(first.receipt.openapi,
      "https://programmable.market/openapi/custom-launch-v4.json");
    const outputKeys = deepObjectKeys(first);
    for (const forbidden of [
      "privateKey",
      "signature",
      "signedTransaction",
      "rawTransaction",
    ]) {
      assert.equal(outputKeys.has(forbidden), false, forbidden);
    }
    assert.equal(
      first.request.chainDeployment.deploymentEvidence.transactionHash,
      v4ChainDeployment.deploymentEvidence.transactionHash,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("V4 pack rejects 2-target and cross-chain configs before compiling", async () => {
  const fixture = await materializeV4CompiledFixture();
  try {
    const original = JSON.parse(await readFile(fixture.configPath, "utf8"));
    const twoTargets = structuredClone(original);
    twoTargets.targets.length = 2;
    await writeFile(fixture.configPath, `${JSON.stringify(twoTargets, null, 2)}\n`, "utf8");
    await assert.rejects(
      buildLaunch({ configPath: fixture.configPath }),
      /targets must contain between 3 and 16/u,
    );

    const wrongChain = structuredClone(original);
    wrongChain.chainId = "1";
    await writeFile(fixture.configPath, `${JSON.stringify(wrongChain, null, 2)}\n`, "utf8");
    await assert.rejects(
      buildLaunch({ configPath: fixture.configPath }),
      /must bind Robinhood Chain mainnet/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("V4 funding value exactly covers every graph deployment and initializer value", async () => {
  const fixture = await materializeV4CompiledFixture();
  try {
    const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
    config.targets[0].deploymentValueWei = "2";
    config.targets[2].deploymentValueWei = "3";
    config.funding = {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "wallet-transaction-value",
      valueWei: "5",
    };
    await writeFile(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const built = await buildLaunch({ configPath: fixture.configPath });
    assert.equal(built.request.funding.valueWei, "5");

    config.funding.valueWei = "4";
    await writeFile(fixture.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await assert.rejects(
      buildLaunch({ configPath: fixture.configPath }),
      /exactly equal the sum/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function materializeV4CompiledFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-launch-v4-pack-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "out"), { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await mkdir(path.join(root, "evidence"), { recursive: true });
  const sources = {
    "src/RobinhoodToken.sol": {
      content: [
        "// SPDX-License-Identifier: UNLICENSED",
        "pragma solidity 0.8.26;",
        "contract RobinhoodToken {",
        "  string public constant name = 'Robinhood V4 Test';",
        "  string public constant symbol = 'RHV4';",
        "}",
        "",
      ].join("\n"),
    },
    "src/RobinhoodHook.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract RobinhoodHook { function marker() external pure returns (uint256) { return 4663; } }\n",
    },
    "src/RobinhoodInitializer.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract RobinhoodInitializer { function marker() external pure returns (bytes4) { return this.marker.selector; } }\n",
    },
  };
  for (const [sourcePath, source] of Object.entries(sources)) {
    await writeFile(path.join(root, sourcePath), source.content, "utf8");
  }
  const standardJson = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none", appendCBOR: false, useLiteralContent: true },
      libraries: {},
      remappings: [],
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "metadata",
            "evm.bytecode.object",
            "evm.bytecode.linkReferences",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.linkReferences",
            "evm.deployedBytecode.immutableReferences",
          ],
        },
      },
    },
  };
  await writeFile(
    path.join(root, "standard-json.json"),
    `${JSON.stringify(standardJson)}\n`,
    "utf8",
  );
  const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  assert.deepEqual(errors, []);
  for (const [sourcePath, contractName, artifactName] of [
    ["src/RobinhoodToken.sol", "RobinhoodToken", "token"],
    ["src/RobinhoodHook.sol", "RobinhoodHook", "hook"],
    ["src/RobinhoodInitializer.sol", "RobinhoodInitializer", "initializer"],
  ]) {
    const compiled = output.contracts[sourcePath][contractName];
    await writeFile(path.join(root, "out", `${artifactName}.json`), `${JSON.stringify({
      abi: compiled.abi,
      bytecode: compiled.evm.bytecode,
      deployedBytecode: compiled.evm.deployedBytecode,
      metadata: compiled.metadata,
    })}\n`, "utf8");
  }
  await writeFile(
    path.join(root, "assets", "token.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(path.join(root, "evidence", "build.json"), `${JSON.stringify({
    schemaVersion: "programmable.v4-pack-test-evidence.v1",
    compilerVersion: solc.version(),
    errorCount: 0,
    signs: false,
    broadcasts: false,
  })}\n`, "utf8");

  const commonTarget = {
    compilationUnitId: "robinhood-fixture",
    constructorArguments: [],
    initializer: null,
    deploymentValueWei: "0",
    initializerValueWei: "0",
    declaredHookPermissions: null,
    runtimeImmutables: [],
  };
  const config = {
    schemaVersion: "programmable.launch-pack-config.v4",
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeployment: v4ChainDeployment,
    profile: v4Profile,
    externalContracts: [],
    launchWallet: "0x1111111111111111111111111111111111111111",
    nonce: `0x${"44".repeat(32)}`,
    permitWindow: { validAfter: "1", deadline: "2" },
    source: {
      root: ".",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: {
        url: "https://github.com/programmablehq/PROGRAMMABLE",
        revision: "11".repeat(20),
      },
    },
    compilationUnits: [{
      compilationUnitId: "robinhood-fixture",
      standardJson: "standard-json.json",
    }],
    targets: [
      {
        ...commonTarget,
        targetId: "token",
        artifact: "out/token.json",
        applicantSalt: `0x${"01".repeat(32)}`,
        componentKind: "token",
      },
      {
        ...commonTarget,
        targetId: "hook",
        artifact: "out/hook.json",
        applicantSalt: {
          mode: "deterministic-hook-permission-grind-v1",
          start: "0",
          maxAttempts: "262144",
        },
        componentKind: "hook",
        declaredHookPermissions: ["beforeSwap"],
      },
      {
        ...commonTarget,
        targetId: "initializer",
        artifact: "out/initializer.json",
        applicantSalt: `0x${"03".repeat(32)}`,
        componentKind: "other",
      },
    ],
    pool: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      fee: 3_000,
      tickSpacing: 60,
      quoteCurrency: "0x0000000000000000000000000000000000000000",
    },
    projectMetadata: {
      schemaVersion: "programmable.project-metadata-input.v1",
      token: { name: "Robinhood V4 Test", symbol: "RHV4" },
      presentation: {
        description: "Deterministic three-target Robinhood V4 no-broadcast test launch",
        image: {
          sourcePath: "assets/token.png",
          uri: "https://example.com/token.png",
        },
        links: [
          { kind: "website", uri: "https://example.com/" },
          { kind: "x", uri: "https://x.com/robinhood_v4_test" },
        ],
      },
    },
    funding: {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    liquidityModel: {
      schemaVersion: "programmable.custom-launch-liquidity-model.v1",
      model: "none-empty-pool",
      declaredLaunchState: "pool-not-initialized",
      targetIds: [],
    },
    agentAttestation: {
      agentId: "v4-pack-test",
      checkedAt: "2026-08-29T12:00:00.000Z",
      checks: [{ checkId: "exact-build", evidence: "evidence/build.json" }],
    },
  };
  const configPath = path.join(root, "programmable-launch.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { root, configPath };
}

function deepObjectKeys(value, keys = new Set()) {
  if (value === null || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const entry of value) deepObjectKeys(entry, keys);
    return keys;
  }
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    deepObjectKeys(entry, keys);
  }
  return keys;
}
