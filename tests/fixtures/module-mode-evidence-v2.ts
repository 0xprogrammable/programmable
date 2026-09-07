// Synthetic V2 fixture derived from the frozen Native V1 fixture and exact Native V2 contract domains.
// This is not deployment data; the collector tests produce finality through the real observer.
import {
  encodeAbiParameters,
  encodeEventTopics,
  getCreate2Address,
  keccak256,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  MODULE_MODE_DEPENDENCIES,
} from "../../lib/module-mode/release";
import { computeModuleModeReleaseDigestV2, MODULE_MODE_ECONOMICS_POLICY_V2 } from "../../lib/module-mode/release-v2";
import { moduleModeEconomicsAbiV2 as MODULE_INDEX_ABI_V2 } from "../../lib/module-mode/economics-v2";
const preview = {
  schemaVersion: "programmable.module-mode-source.v2",
  sourceVersion: "module-native-v2", economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2,
  chainId: 4663,
  finalityPolicy: "robinhood-ethereum-finalized-v1",
};
import { moduleModeLaunchAbi } from "../../lib/module-mode/provenance";

export const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
export const a = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const selectionType =
  "(bytes32 packageId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,uint32 callbackGas,bytes config)[]";

// Synthetic test-only coordinates and runtimes, never deployment or finality evidence.
export function moduleEvidenceFixtureV2(seed = 0, moduleCount = 2, sourceSeed = 1, input: { families?: readonly number[]; eligible?: readonly boolean[] } = {}) {
  const roles = MODULE_MODE_DEPENDENCIES;
  const contracts = Object.fromEntries(
    roles.map((role, i) => [
      role,
      {
        address: a(i + 1 + sourceSeed * 1000),
        runtimeCodeHash: keccak256(toHex(`fixture ${role}`)),
      },
    ]),
  ) as Record<
    (typeof roles)[number],
    { address: Address; runtimeCodeHash: Hex }
  >;
  const release = {
    ...preview,
    enabled: true,
    status: "active",
    releaseDigest: h(999),
    sourceCommit: "a".repeat(40),
    deploymentEvidenceDigest: h(901),
    sourceVerificationDigest: h(902),
    lifecycleEvidenceDigest: h(903),
    startBlock: "50",
    minimumInitialBuyNative: "1000",
    tokenCreationCodeHash: keccak256("0x60026002"),
    contracts,
  };
  release.releaseDigest = computeModuleModeReleaseDigestV2(release);
  const wallet = a(90);
  const name = `Fixture ${seed}`;
  const symbol = `F${seed}`;
  const creatorSalt = h(500 + seed);
  const graffiti = keccak256(
    encodeAbiParameters(
      parseAbiParameters("string,uint256,address,address,bytes32"),
      [
        "programmable.module-mode.native-token.v2",
        4663n,
        contracts.launcher.address,
        wallet,
        creatorSalt,
      ],
    ),
  );
  const salt = keccak256(
    encodeAbiParameters(
      parseAbiParameters("string,string,uint8,address,bytes32"),
      [name, symbol, 18, contracts.launcher.address, graffiti],
    ),
  );
  const token = getCreate2Address({
    from: contracts.tokenFactory.address,
    salt,
    bytecodeHash: release.tokenCreationCodeHash,
  }).toLowerCase() as Address;
  const key = {
    currency0: a(0),
    currency1: token,
    fee: 0,
    tickSpacing: 200,
    hooks: contracts.hook.address,
  };
  const poolId = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address,address,uint24,int24,address"),
      [key.currency0, token, 0, 200, key.hooks],
    ),
  );
  const families = Array.from({ length: moduleCount }, (_, i) => h(input.families?.[i] ?? (100 + i)));
  const selectionEligible = families.map((_, i) => input.eligible?.[i] ?? true);
  const selectionReviewDigests = families.map(family => keccak256(encodeAbiParameters(parseAbiParameters("bytes32"), [family])));
  const eligibilityReviews = families.map((family, i) => keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bool,bytes32"), [family, selectionEligible[i]!, selectionReviewDigests[i]!])));
  const eligibleFamilies = [...new Set(families.filter((_, i) => selectionEligible[i]))].sort();
  const authorPoolFeeBps = eligibleFamilies.length === 0 ? 0 : 20;
  const platformFeeBps = 10 + authorPoolFeeBps;
  const selections = families.map((_, i) => ({
    packageId: h(200 + i),
    factory: a(100 + i),
    factoryCodeHash: keccak256(toHex(`factory${i}`)),
    moduleCodeHash: keccak256(toHex(`program${i}`)),
    callbackGas: 25000,
    config: toHex(`config${i}`),
  }));
  const recipeHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        `string,uint256,address,address,bytes32,bytes32[],uint16,uint16,bytes32[],${selectionType}`,
      ),
      [
        "programmable.module-mode.native-recipe.v2",
        4663n,
        contracts.hook.address,
        contracts.registry.address,
        MODULE_MODE_ECONOMICS_POLICY_V2,
        eligibilityReviews,
        0,
        1000,
        eligibleFamilies,
        selections,
      ],
    ),
  );
  const programHash = keccak256(
    encodeAbiParameters(parseAbiParameters(`bytes32,${selectionType}`), [
      keccak256(toHex("programmable.module-mode.native-program.v1")),
      selections,
    ]),
  );
  const binding = {
    source: contracts.launcher.address,
    launchWallet: wallet,
    token,
    poolManager: contracts.poolManager.address,
    poolId,
    recipeHash,
    programHash,
  };
  const launchKey = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,uint256,address,address,(address source,address launchWallet,address token,address poolManager,bytes32 poolId,bytes32 recipeHash,bytes32 programHash)",
      ),
      [
        keccak256(toHex("programmable.module-mode.native-binding.v1")),
        4663n,
        contracts.runtime.address,
        contracts.hook.address,
        binding,
      ],
    ),
  );
  const metadataHash = h(300);
  const creatorConfigurationHash = h(301);
  const economicsHash = h(302);
  const launchId = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string,uint256,address,address,address,address,bytes32,bytes32,bytes32,bytes32",
      ),
      [
        "programmable.module-mode.native-launch.v2",
        4663n,
        contracts.launcher.address,
        wallet,
        token,
        contracts.poolManager.address,
        poolId,
        recipeHash,
        metadataHash,
        economicsHash,
      ],
    ),
  );
  const launch = {
    launchId,
    launchWallet: wallet,
    token,
    poolId,
    recipeHash,
    hook: contracts.hook.address,
    positionRecipient: a(80),
    positionTokenId: "1",
    initialBuyNative: "1000",
    initialBuyTokens: "90000",
    runtime: contracts.runtime.address,
    launchKey,
  };
  const block = {
    chainId: 4663,
    blockNumber: String(100 + seed),
    blockHash: h(400 + seed),
  };
  const transactionHash = h(600 + seed + sourceSeed * 1000);
  const log = (
    name:
      | "ModuleNativeLaunched"
      | "ModuleNativeProgramBound"
      | "ModuleNativeConfigurationBound"
      | "ModuleNativeTokenIdentityBound",
    args: Record<string, Address | Hex | bigint>,
    data: Hex,
    index: number,
  ) => ({
    ...block,
    transactionHash,
    logIndex: index,
    address: contracts.launcher.address,
    topics: encodeEventTopics({
      abi: moduleModeLaunchAbi,
      eventName: name,
      args,
    }),
    data,
    removed: false,
  });
  const funding = families.map(() => "10");
  const fundingHash = keccak256(
    encodeAbiParameters(parseAbiParameters("uint256[]"), [funding.map(BigInt)]),
  );
  const instances = selections.map((s, index) => {
    const instanceId = keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [
        launchKey,
        BigInt(index),
      ]),
    );
    const configHash = keccak256(s.config);
    return {
      instanceId,
      packageId: s.packageId,
      configHash,
      factory: s.factory,
      factoryCodeHash: s.factoryCodeHash,
      module: a(200 + index),
      moduleCodeHash: s.moduleCodeHash,
      callbackGas: s.callbackGas,
      bindingHash: keccak256(
        encodeAbiParameters(
          parseAbiParameters(
            "(address runtime,bytes32 launchKey,bytes32 instanceId,bytes32 packageId,bytes32 configHash)",
          ),
          [
            {
              runtime: contracts.runtime.address,
              launchKey,
              instanceId,
              packageId: s.packageId,
              configHash,
            },
          ],
        ),
      ),
    };
  });
  const evidence = {
    schemaVersion: "programmable.module-mode-evidence.v2",
    economicsEvent: { ...block, transactionHash, logIndex: 32, address: contracts.hook.address, removed: false,
      topics: encodeEventTopics({ abi: MODULE_INDEX_ABI_V2, eventName: "NativeEconomicsBound", args: { poolId, economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 } }),
      data: encodeAbiParameters(parseAbiParameters("uint16,uint16,bytes32[],bool[],bytes32[]"), [10, authorPoolFeeBps, eligibleFamilies, selectionEligible, selectionReviewDigests]) },
    economics: { ...block, address: contracts.hook.address, sourceVersion: "module-native-v2",
      policyIds: { launcher: MODULE_MODE_ECONOMICS_POLICY_V2, hook: MODULE_MODE_ECONOMICS_POLICY_V2, swapRouter: MODULE_MODE_ECONOMICS_POLICY_V2, rewardLedger: MODULE_MODE_ECONOMICS_POLICY_V2 },
      platformFeeBps, selectionEligible, selectionReviewDigests },
    header: block,
    receipt: { ...block, transactionHash, status: "success" },
    event: log(
      "ModuleNativeLaunched",
      { launchId, launchWallet: wallet, token },
      encodeAbiParameters(
        parseAbiParameters(
          "bytes32,bytes32,address,address,uint256,uint256,uint256",
        ),
        [
          poolId,
          recipeHash,
          launch.hook,
          launch.positionRecipient,
          1n,
          1000n,
          90000n,
        ],
      ),
      40,
    ),
    programEvent: log(
      "ModuleNativeProgramBound",
      { launchId, launchKey, runtime: launch.runtime },
      encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [
        fundingHash,
        BigInt(moduleCount * 10),
      ]),
      42,
    ),
    configurationEvent: log(
      "ModuleNativeConfigurationBound",
      { launchId },
      encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32"), [
        metadataHash,
        creatorConfigurationHash,
        economicsHash,
      ]),
      41,
    ),
    tokenIdentityEvent: log(
      "ModuleNativeTokenIdentityBound",
      { launchId },
      encodeAbiParameters(parseAbiParameters("bytes32,bytes32"), [
        creatorSalt,
        graffiti,
      ]),
      43,
    ),
    getLaunch: {
      ...block,
      address: contracts.launcher.address,
      token,
      tokenFactory: contracts.tokenFactory.address,
      record: launch,
    },
    identity: {
      ...block,
      address: contracts.launcher.address,
      version: 1,
      record: {
        launchId,
        launchWallet: wallet,
        token,
        poolManager: contracts.poolManager.address,
        poolId,
        hook: launch.hook,
        recipeHash,
      },
    },
    token: {
      ...block,
      address: token,
      name,
      symbol,
      decimals: 18,
      totalSupply: "1000000000000000000000000000",
      creator: contracts.launcher.address,
      graffiti,
      creatorSalt,
      factoryPrediction: token,
    },
    pool: {
      ...block,
      address: contracts.poolManager.address,
      poolId,
      key,
      sqrtPriceX96: (1n << 96n).toString(),
    },
    program: {
      ...block,
      address: contracts.runtime.address,
      engine: contracts.hook.address,
      engineCodeHash: contracts.hook.runtimeCodeHash,
      vault: contracts.budgetVault.address,
      ...binding,
      launchKey,
      router: contracts.swapRouter.address,
      routerCodeHash: contracts.swapRouter.runtimeCodeHash,
      buyCreatorFeeBps: 0,
      sellCreatorFeeBps: 1000,
      selections,
      families,
      instances,
      funding,
    },
    registry: {
      ...block,
      address: contracts.registry.address,
      revisions: selections.map((s, i) => ({
        packageId: s.packageId,
        familyId: families[i],
        factory: s.factory,
        factoryCodeHash: s.factoryCodeHash,
        moduleCodeHash: s.moduleCodeHash,
        manifestHash: h(800 + i),
        callbackGas: s.callbackGas,
        enabled: true,
        author: a(300 + families.indexOf(families[i]!)),
      })),
    },
    runtimeReads: [
      ...roles.map((role) => ({
        ...block,
        address: contracts[role].address,
        code: toHex(`fixture ${role}`),
      })),
      { ...block, address: token, code: toHex(`fixture token ${name}`) },
      ...selections.flatMap((s, i) => [
        { ...block, address: s.factory, code: toHex(`factory${i}`) },
        { ...block, address: instances[i]!.module, code: toHex(`program${i}`) },
      ]),
    ],
    verification: {
      status: "verified",
      policy: "robinhood-ethereum-finalized-v1",
      verificationDigest: h(700),
      sourceReleaseDigest: release.releaseDigest,
      l2: { ...block, transactionHash },
      l1Posting: {
        chainId: 1,
        blockNumber: "200",
        blockHash: h(2000),
        transactionHash: h(2001),
        batchNumber: "9",
      },
      l1Finalized: {
        chainId: 1,
        blockNumber: "205",
        blockHash: h(2050),
        tag: "finalized",
      },
      providers: [
        {
          id: "fixture-a",
          trustDomain: "fixture-a.invalid",
          chainId: 4663,
          blockNumber: block.blockNumber,
          blockHash: block.blockHash,
        },
        {
          id: "fixture-b",
          trustDomain: "fixture-b.invalid",
          chainId: 4663,
          blockNumber: block.blockNumber,
          blockHash: block.blockHash,
        },
        {
          id: "fixture-c",
          trustDomain: "fixture-c.invalid",
          chainId: 1,
          blockNumber: "205",
          blockHash: h(2050),
        },
        {
          id: "fixture-d",
          trustDomain: "fixture-d.invalid",
          chainId: 1,
          blockNumber: "205",
          blockHash: h(2050),
        },
      ],
    },
  };
  return { release, evidence };
}
