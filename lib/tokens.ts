import type { LaunchPartnerAttributionV1 } from
  "./launch-partner-attribution";

export type TokenLinkKind = "website" | "x" | "telegram" | "discord" | "github" | "gitbook";

export type TokenLink = {
  kind: TokenLinkKind;
  url: string;
};

export type ProjectMetadataLinkKind =
  | "website"
  | "documentation"
  | "x"
  | "telegram"
  | "discord"
  | "github"
  | "other";

export type ProjectMetadataLink = Readonly<{
  kind: ProjectMetadataLinkKind;
  url: string;
}>;

export type ProjectMetadataStatus = "current" | "last-known-good";

export type TokenTone = "rose" | "violet" | "mint" | "amber" | "sky" | "peach";

export type LaunchStampProvenanceV1 = Readonly<{
  schemaVersion: "programmable.launch-stamp-provenance.v1";
  chainId: number;
  routerAddress: `0x${string}`;
  routerRuntimeCodeHash: `0x${string}`;
  routerStartBlock: string;
  finalityConfirmations: number;
  kind: "custom-graph" | "classic";
  launchId: `0x${string}`;
  stampHash: `0x${string}`;
  launchWallet: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  transactionIndex: number;
  routeLogIndex: number;
  launchLogIndex: number;
  finalizedAtBlockNumber: string;
  finalizedAtBlockHash: `0x${string}`;
  poolManagerAddress: `0x${string}`;
  poolId: `0x${string}`;
  poolKey: Readonly<{
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
  }>;
  poolKeyHash: `0x${string}`;
  componentSetHash: `0x${string}`;
  routePayloadHash: `0x${string}`;
  routeLauncherAddress: `0x${string}`;
  routeLauncherRuntimeCodeHash: `0x${string}`;
  expectedResultHash: `0x${string}`;
  permitDigest: `0x${string}`;
  components: readonly Readonly<{
    address: `0x${string}`;
    kind: "token" | "hook" | "other";
    scope: "exclusive" | "shared-infrastructure";
    runtimeCodeHash: `0x${string}`;
    logIndex: number;
    exclusiveProof: Readonly<{
      launchId: `0x${string}`;
      stampHash: `0x${string}`;
    }> | null;
  }>[];
  tokenProof: Readonly<{
    tokenAddress: `0x${string}`;
    launchId: `0x${string}`;
    stampHash: `0x${string}`;
  }>;
  poolProof: Readonly<{
    poolManagerAddress: `0x${string}`;
    poolId: `0x${string}`;
    launchId: `0x${string}`;
    stampHash: `0x${string}`;
  }>;
}>;

export type PlatformFeePolicyRuntimeRoleV2 =
  | "router"
  | "route-launcher"
  | "pool-manager"
  | "state-view"
  | "token"
  | "hook"
  | "vault"
  | "initializer"
  | "custom-module";

export const CANONICAL_PLATFORM_FEE_POLICY_V2 = Object.freeze({
  chainId: "1",
  policyVersion: 2,
  graphFactoryAddress: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
  graphFactoryRuntimeCodeHash:
    "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  ratePpm: 1000,
  denominatorPpm: 1_000_000,
  recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  requiredHookFlags: 0x2044,
  finalityConfirmations: 64,
} as const);

/**
 * A separately derived fee-policy proof for a finalized Router launch.
 *
 * This does not replace the launch stamp and deliberately does not grant a
 * trade or claim capability. The Website may attach it only after one trusted
 * profile build and every runtime/binding read below match at one finalized
 * Ethereum block.
 */
export type PlatformFeePolicyReadbackV2 = Readonly<{
  schemaVersion: "programmable.platform-fee-policy-readback.v2";
  status: "onchain-confirmed";
  chainId: "1";
  profileBuildId: `sha256:${string}`;
  sourceBundleDigest: `sha256:${string}`;
  compilerArtifactDigest: `sha256:${string}`;
  compilerSettingsHash: `0x${string}`;
  profile: "zero-custom" | "isolated-after-swap-zero-delta-opcode-safe";
  policyVersion: 2;
  policyId: `0x${string}`;
  profileId: `0x${string}`;
  basis: Readonly<{
    id: `0x${string}`;
    kind: "gross-unspecified-pool-currency-amount";
  }>;
  assetMode: Readonly<{
    id: `0x${string}`;
    kind: "unspecified-pool-currency-per-swap";
  }>;
  ratePpm: 1000;
  denominatorPpm: 1_000_000;
  recipient: `0x${string}`;
  requiredHookFlags: 0x2044;
  poolId: `0x${string}`;
  initialSqrtPriceX96: string;
  initializer: `0x${string}`;
  deploymentProfileHash: `0x${string}`;
  compositionHash: `0x${string}`;
  customModule: `0x${string}` | null;
  customModuleRuntimeCodeHash: `0x${string}` | null;
  customDeltaAccount: `0x${string}` | null;
  maximumCustomDeltaAbsolute: string;
  evidence: Readonly<{
    source: "ethereum-mainnet-finalized-state";
    blockNumber: string;
    blockHash: `0x${string}`;
    finalityConfirmations: 64;
    contracts: readonly Readonly<{
      role: PlatformFeePolicyRuntimeRoleV2;
      address: `0x${string}`;
      runtimeCodeHash: `0x${string}`;
    }>[];
  }>;
}>;

export const CANONICAL_LAUNCH_STAMP_V1 = Object.freeze({
  chainId: 1,
  routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
  routerRuntimeCodeHash:
    "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
  routerStartBlock: "25717612",
  finalityConfirmations: 64,
  poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
} as const);

export const CANONICAL_ROBINHOOD_LAUNCH_STAMP_V1 = Object.freeze({
  chainId: 4663,
  routerAddress: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
  routerRuntimeCodeHash:
    "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  routerStartBlock: "50469365",
  finalityConfirmations: 64,
  poolManagerAddress: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
} as const);

type LaunchStampExpectedIdentity = Readonly<{
  chainId?: number;
  tokenAddress?: `0x${string}`;
  hookAddress?: `0x${string}`;
  poolId?: `0x${string}`;
  launchWallet?: `0x${string}`;
  transactionHash?: `0x${string}`;
  blockNumber?: string;
  transactionIndex?: number;
  launchLogIndex?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value);
}

function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
}

function isNonZeroBytes32(value: unknown): value is `0x${string}` {
  return isBytes32(value) && BigInt(value) !== 0n;
}

function isNonZeroAddress(value: unknown): value is `0x${string}` {
  return isAddress(value) && BigInt(value) !== 0n;
}

function areCanonicalCurrencies(value: unknown): value is Readonly<{
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: unknown;
  tickSpacing: unknown;
  hooks: unknown;
}> {
  return isRecord(value) &&
    isAddress(value.currency0) &&
    isAddress(value.currency1) &&
    BigInt(value.currency0) < BigInt(value.currency1);
}

function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value);
}

function sameHex(left: unknown, right: unknown) {
  return typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase();
}

function isSha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isPlatformFeeRuntimeRoleV2(
  value: unknown,
): value is PlatformFeePolicyRuntimeRoleV2 {
  return value === "router" ||
    value === "route-launcher" ||
    value === "pool-manager" ||
    value === "state-view" ||
    value === "token" ||
    value === "hook" ||
    value === "vault" ||
    value === "initializer" ||
    value === "custom-module";
}

export function isPlatformFeePolicyReadbackV2(
  value: unknown,
  expected: Readonly<{
    tokenAddress?: `0x${string}`;
    hookAddress?: `0x${string}`;
    poolId?: `0x${string}`;
  }> = {},
): value is PlatformFeePolicyReadbackV2 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "programmable.platform-fee-policy-readback.v2" ||
    value.status !== "onchain-confirmed" ||
    value.chainId !== CANONICAL_PLATFORM_FEE_POLICY_V2.chainId ||
    !isSha256Digest(value.profileBuildId) ||
    !isSha256Digest(value.sourceBundleDigest) ||
    !isSha256Digest(value.compilerArtifactDigest) ||
    !isNonZeroBytes32(value.compilerSettingsHash) ||
    (value.profile !== "zero-custom" &&
      value.profile !== "isolated-after-swap-zero-delta-opcode-safe") ||
    value.policyVersion !== CANONICAL_PLATFORM_FEE_POLICY_V2.policyVersion ||
    !isNonZeroBytes32(value.policyId) ||
    !isNonZeroBytes32(value.profileId) ||
    !isRecord(value.basis) ||
    !isNonZeroBytes32(value.basis.id) ||
    value.basis.kind !== "gross-unspecified-pool-currency-amount" ||
    !isRecord(value.assetMode) ||
    !isNonZeroBytes32(value.assetMode.id) ||
    value.assetMode.kind !== "unspecified-pool-currency-per-swap" ||
    value.ratePpm !== CANONICAL_PLATFORM_FEE_POLICY_V2.ratePpm ||
    value.denominatorPpm !==
      CANONICAL_PLATFORM_FEE_POLICY_V2.denominatorPpm ||
    !sameHex(value.recipient, CANONICAL_PLATFORM_FEE_POLICY_V2.recipient) ||
    value.requiredHookFlags !==
      CANONICAL_PLATFORM_FEE_POLICY_V2.requiredHookFlags ||
    !isNonZeroBytes32(value.poolId) ||
    !isUnsignedDecimal(value.initialSqrtPriceX96) ||
    value.initialSqrtPriceX96 === "0" ||
    !isNonZeroAddress(value.initializer) ||
    !isNonZeroBytes32(value.deploymentProfileHash) ||
    !isNonZeroBytes32(value.compositionHash) ||
    !isUnsignedDecimal(value.maximumCustomDeltaAbsolute) ||
    !isRecord(value.evidence) ||
    value.evidence.source !== "ethereum-mainnet-finalized-state" ||
    !isUnsignedDecimal(value.evidence.blockNumber) ||
    !isBytes32(value.evidence.blockHash) ||
    value.evidence.finalityConfirmations !==
      CANONICAL_PLATFORM_FEE_POLICY_V2.finalityConfirmations ||
    !Array.isArray(value.evidence.contracts)
  ) {
    return false;
  }

  if (
    (expected.poolId !== undefined &&
      !sameHex(value.poolId, expected.poolId)) ||
    (value.profile === "zero-custom" &&
      (value.customModule !== null ||
        value.customModuleRuntimeCodeHash !== null ||
        value.customDeltaAccount !== null ||
        value.maximumCustomDeltaAbsolute !== "0")) ||
    (value.profile === "isolated-after-swap-zero-delta-opcode-safe" &&
      (!isNonZeroAddress(value.customModule) ||
        !isNonZeroBytes32(value.customModuleRuntimeCodeHash) ||
        value.customDeltaAccount !== null ||
        value.maximumCustomDeltaAbsolute !== "0"))
  ) {
    return false;
  }

  const requiredRoles = new Set<PlatformFeePolicyRuntimeRoleV2>([
    "router",
    "route-launcher",
    "pool-manager",
    "state-view",
    "token",
    "hook",
    "vault",
    "initializer",
  ]);
  const roles = new Set<PlatformFeePolicyRuntimeRoleV2>();
  const addresses = new Set<string>();
  for (const contract of value.evidence.contracts) {
    if (
      !isRecord(contract) ||
      !isPlatformFeeRuntimeRoleV2(contract.role) ||
      !isNonZeroAddress(contract.address) ||
      !isNonZeroBytes32(contract.runtimeCodeHash) ||
      roles.has(contract.role) ||
      addresses.has(contract.address.toLowerCase())
    ) {
      return false;
    }
    roles.add(contract.role);
    addresses.add(contract.address.toLowerCase());
    requiredRoles.delete(contract.role);
    if (
      contract.role === "initializer" &&
      !sameHex(contract.address, value.initializer)
    ) {
      return false;
    }
    if (
      contract.role === "token" &&
      expected.tokenAddress !== undefined &&
      !sameHex(contract.address, expected.tokenAddress)
    ) {
      return false;
    }
    if (
      contract.role === "hook" &&
      expected.hookAddress !== undefined &&
      !sameHex(contract.address, expected.hookAddress)
    ) {
      return false;
    }
  }

  return requiredRoles.size === 0 &&
    roles.has("custom-module") ===
      (value.profile === "isolated-after-swap-zero-delta-opcode-safe");
}

/**
 * Validates the complete, finalized Router proof carried through the public
 * Website and indexer surfaces. PoolId recomputation and onchain getter checks
 * remain server-side responsibilities; this guard prevents a partial or
 * category-mismatched proof from being rendered as canonical provenance.
 */
export function isLaunchStampProvenanceV1(
  value: unknown,
  expected: LaunchStampExpectedIdentity = {},
): value is LaunchStampProvenanceV1 {
  const canonical = isRecord(value)
    ? value.chainId === CANONICAL_LAUNCH_STAMP_V1.chainId
      ? CANONICAL_LAUNCH_STAMP_V1
      : value.chainId === CANONICAL_ROBINHOOD_LAUNCH_STAMP_V1.chainId
        ? CANONICAL_ROBINHOOD_LAUNCH_STAMP_V1
        : null
    : null;
  if (
    !isRecord(value) ||
    value.schemaVersion !== "programmable.launch-stamp-provenance.v1" ||
    !Number.isSafeInteger(value.chainId) ||
    canonical === null ||
    !isAddress(value.routerAddress) ||
    !sameHex(
      value.routerAddress,
      canonical.routerAddress,
    ) ||
    !isBytes32(value.routerRuntimeCodeHash) ||
    !sameHex(
      value.routerRuntimeCodeHash,
      canonical.routerRuntimeCodeHash,
    ) ||
    !isUnsignedDecimal(value.routerStartBlock) ||
    value.routerStartBlock !== canonical.routerStartBlock ||
    !Number.isSafeInteger(value.finalityConfirmations) ||
    value.finalityConfirmations !==
      canonical.finalityConfirmations ||
    (value.kind !== "custom-graph" && value.kind !== "classic") ||
    !isBytes32(value.launchId) ||
    !isBytes32(value.stampHash) ||
    !isNonZeroAddress(value.launchWallet) ||
    !isBytes32(value.transactionHash) ||
    !isUnsignedDecimal(value.blockNumber) ||
    !isBytes32(value.blockHash) ||
    !Number.isSafeInteger(value.transactionIndex) ||
    Number(value.transactionIndex) < 0 ||
    !Number.isSafeInteger(value.routeLogIndex) ||
    Number(value.routeLogIndex) < 0 ||
    !Number.isSafeInteger(value.launchLogIndex) ||
    Number(value.launchLogIndex) !== Number(value.routeLogIndex) + 1 ||
    !isUnsignedDecimal(value.finalizedAtBlockNumber) ||
    !isBytes32(value.finalizedAtBlockHash) ||
    !isAddress(value.poolManagerAddress) ||
    !sameHex(
      value.poolManagerAddress,
      canonical.poolManagerAddress,
    ) ||
    !isBytes32(value.poolId) ||
    !areCanonicalCurrencies(value.poolKey) ||
    !Number.isSafeInteger(value.poolKey.fee) ||
    Number(value.poolKey.fee) < 0 ||
    (Number(value.poolKey.fee) !== 0x80_00_00 &&
      Number(value.poolKey.fee) > 1_000_000) ||
    !Number.isSafeInteger(value.poolKey.tickSpacing) ||
    Number(value.poolKey.tickSpacing) < 1 ||
    Number(value.poolKey.tickSpacing) > 32_767 ||
    !isAddress(value.poolKey.hooks) ||
    !isNonZeroBytes32(value.poolKeyHash) ||
    !isNonZeroBytes32(value.componentSetHash) ||
    !isBytes32(value.routePayloadHash) ||
    !isNonZeroAddress(value.routeLauncherAddress) ||
    !isNonZeroBytes32(value.routeLauncherRuntimeCodeHash) ||
    !isBytes32(value.expectedResultHash) ||
    !isBytes32(value.permitDigest) ||
    !Array.isArray(value.components) ||
    value.components.length < 2 ||
    value.components.length > 16 ||
    !isRecord(value.tokenProof) ||
    !isNonZeroAddress(value.tokenProof.tokenAddress) ||
    !sameHex(value.tokenProof.launchId, value.launchId) ||
    !sameHex(value.tokenProof.stampHash, value.stampHash) ||
    !isRecord(value.poolProof) ||
    !sameHex(value.poolProof.poolManagerAddress, value.poolManagerAddress) ||
    !sameHex(value.poolProof.poolId, value.poolId) ||
    !sameHex(value.poolProof.launchId, value.launchId) ||
    !sameHex(value.poolProof.stampHash, value.stampHash)
  ) {
    return false;
  }

  if (
    BigInt(value.blockNumber) < BigInt(value.routerStartBlock) ||
    BigInt(value.finalizedAtBlockNumber) <
      BigInt(value.blockNumber) + BigInt(value.finalityConfirmations) ||
    (expected.chainId !== undefined && value.chainId !== expected.chainId) ||
    (expected.tokenAddress !== undefined &&
      !sameHex(value.tokenProof.tokenAddress, expected.tokenAddress)) ||
    (expected.hookAddress !== undefined &&
      !sameHex(value.poolKey.hooks, expected.hookAddress)) ||
    (expected.poolId !== undefined && !sameHex(value.poolId, expected.poolId))
    || (expected.launchWallet !== undefined &&
      !sameHex(value.launchWallet, expected.launchWallet))
    || (expected.transactionHash !== undefined &&
      !sameHex(value.transactionHash, expected.transactionHash))
    || (expected.blockNumber !== undefined &&
      value.blockNumber !== expected.blockNumber)
    || (expected.transactionIndex !== undefined &&
      value.transactionIndex !== expected.transactionIndex)
    || (expected.launchLogIndex !== undefined &&
      value.launchLogIndex !== expected.launchLogIndex)
  ) {
    return false;
  }

  const seenComponents = new Set<string>();
  const seenComponentLogIndexes = new Set<number>();
  let previousComponentLogIndex: number | null = null;
  let tokenComponentCount = 0;
  let hookComponentCount = 0;
  for (const component of value.components) {
    if (
      !isRecord(component) ||
      !isAddress(component.address) ||
      (component.kind !== "token" &&
        component.kind !== "hook" &&
        component.kind !== "other") ||
      (component.scope !== "exclusive" &&
        component.scope !== "shared-infrastructure") ||
      !isNonZeroBytes32(component.runtimeCodeHash) ||
      !Number.isSafeInteger(component.logIndex) ||
      Number(component.logIndex) < 0 ||
      Number(component.logIndex) >= Number(value.routeLogIndex)
    ) {
      return false;
    }
    const componentAddress = component.address.toLowerCase();
    if (seenComponents.has(componentAddress)) return false;
    seenComponents.add(componentAddress);
    const componentLogIndex = Number(component.logIndex);
    if (seenComponentLogIndexes.has(componentLogIndex)) return false;
    if (
      previousComponentLogIndex !== null &&
      componentLogIndex !== previousComponentLogIndex + 1
    ) return false;
    seenComponentLogIndexes.add(componentLogIndex);
    previousComponentLogIndex = componentLogIndex;

    if (component.scope === "exclusive") {
      if (
        !isRecord(component.exclusiveProof) ||
        !sameHex(component.exclusiveProof.launchId, value.launchId) ||
        !sameHex(component.exclusiveProof.stampHash, value.stampHash)
      ) {
        return false;
      }
    } else if (component.exclusiveProof !== null) {
      return false;
    }

    if (
      component.kind === "token" &&
      sameHex(component.address, value.tokenProof.tokenAddress) &&
      component.scope === "exclusive"
    ) {
      tokenComponentCount += 1;
    }
    if (
      component.kind === "hook" &&
      sameHex(component.address, value.poolKey.hooks) &&
      component.scope ===
        (value.kind === "custom-graph" ? "exclusive" : "shared-infrastructure")
    ) {
      hookComponentCount += 1;
    }
  }

  return tokenComponentCount === 1 &&
    hookComponentCount === 1 &&
    previousComponentLogIndex === Number(value.routeLogIndex) - 1;
}

export type ExploreLaunchCategoryProvenance =
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "classic";
      source: "canonical-launch-read-model";
      recordId: string;
      modelId: string | null;
      modelVersion: string | null;
    }>
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "classic" | "custom";
      source: "canonical-launch-stamp-router";
      launchId: `0x${string}`;
      stampHash: `0x${string}`;
      routerAddress: `0x${string}`;
      transactionHash: `0x${string}`;
      blockHash: `0x${string}`;
      blockNumber: string;
      transactionIndex: number;
      logIndex: number;
    }>
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "custom";
      source: "registry.custom-launched";
      projectId: `sha256:${string}`;
      launchId: `sha256:${string}`;
      sourceRecordBindingHash: `sha256:${string}`;
      finalizedLaunchBindingHash: `sha256:${string}`;
      registryAddress: `0x${string}`;
      registryStartBlock: string;
      transactionHash: `0x${string}`;
      blockHash: `0x${string}`;
      blockNumber: string;
      transactionIndex: number;
      logIndex: number;
      configurationHash: `0x${string}`;
    }>
  | Readonly<{
      schemaVersion: "programmable.explore-launch-category-provenance.v1";
      category: "custom";
      source: "interface-preview";
      projectId: `sha256:${string}`;
      launchId: `sha256:${string}`;
      sourceRecordBindingHash: `sha256:${string}`;
      finalizedLaunchBindingHash: `sha256:${string}`;
    }>;

export type DeepV2IndexedLaunchProvenance = {
  deepReleaseVersion: "deep-full-range-v2";
  launcher: `0x${string}`;
  creator: `0x${string}`;
  tokenAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  poolId: `0x${string}`;
  launchHash: `0x${string}`;
  vaultConfigurationHash: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
};

export type DeepV3IndexedLaunchProvenance = {
  deepReleaseVersion: "deep-full-range-v3";
  launchModel: "deep";
  launcher: `0x${string}`;
  creator: `0x${string}`;
  tokenAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  positionRecipient: `0x${string}`;
  positionTokenId: string;
  poolId: `0x${string}`;
  launchHash: `0x${string}`;
  vaultConfigurationHash: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
};

export type LauncherToken = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  links?: TokenLink[];
  projectMetadataLinks?: readonly ProjectMetadataLink[];
  projectMetadataStatus?: ProjectMetadataStatus;
  tokenAddress: `0x${string}`;
  hookAddress: `0x${string}`;
  poolId: `0x${string}`;
  creatorAddress?: `0x${string}`;
  positionRecipient?: `0x${string}`;
  positionTokenId?: string;
  launchHash?: `0x${string}`;
  launchBlockNumber?: string;
  launchTransactionHash?: `0x${string}`;
  launchTransactionIndex?: number;
  launchLogIndex?: number;
  launchDiscoverySource?: "operational-launch-overlay";
  launchedAt: string;
  totalSupply?: string;
  totalSupplyRaw?: string;
  tokenDecimals?: number;
  tokenLiquidityAmountRaw?: string;
  lockedTokenDustRaw?: string;
  initialBuyEthAmountWei?: string;
  initialBuyTokenAmountRaw?: string;
  initialBuyCustody?: Readonly<{
    custodyAddress: `0x${string}` | null;
    mode: "unlocked" | "fixed-lock" | "linear" | "cliff-linear";
    durationDays: number;
    cliffDays: number;
    configurationHash: `0x${string}`;
    cliffTimestamp: string;
    releaseTimestamp: string;
  }>;
  tokenPriceEth?: string;
  tokenPriceEthWei?: string;
  tokenPriceUsdWad?: string;
  marketCapEth?: string;
  marketCapEthWei?: string;
  indexedMarketCapEth?: string;
  indexedMarketCapEthWei?: string;
  indexedMarketCapUsdWad?: string;
  indexedValuationBlockNumber?: string;
  quoteAssetAddress?: `0x${string}`;
  quoteAssetSymbol?: string;
  quoteAssetName?: string;
  quoteIsCurrency0?: boolean;
  rewardVaultAddress?: `0x${string}`;
  tokenPriceQuote?: string;
  tokenPriceQuoteWad?: string;
  marketCapQuote?: string;
  marketCapQuoteWad?: string;
  grossVolumeQuote?: string;
  grossVolumeQuoteRaw?: string;
  creatorFeesGeneratedQuote?: string;
  creatorFeesGeneratedQuoteRaw?: string;
  programmableFeesGeneratedQuote?: string;
  programmableFeesGeneratedQuoteRaw?: string;
  creatorFeesAccruedQuote?: string;
  creatorFeesAccruedQuoteRaw?: string;
  fdvUsdWad?: string;
  liveMarketStateEvidence?: Readonly<{
    source: "uniswap-v4-stateview-v1";
    blockNumber: string;
    blockHash: `0x${string}`;
    sqrtPriceX96: string;
    activeLiquidity: string;
  }>;
  liveMarketPriceEvidence?: Readonly<{
    schemaVersion: "programmable.stateview-chainlink-price-evidence.v1";
    source: "uniswap-v4-stateview-chainlink-v1";
    chainId: "1";
    poolId: `0x${string}`;
    tokenAddress: `0x${string}`;
    quoteAddress: `0x${string}`;
    stateViewAddress: `0x${string}`;
    stateViewRuntimeCodeHash: `0x${string}`;
    blockNumber: string;
    blockHash: `0x${string}`;
    blockTimestamp: string;
    blockTime: string;
    sqrtPriceX96: string;
    activeLiquidity: string;
    activeVirtualToken0Wei: string;
    activeVirtualLiquidityUsdWad: string;
    activeVirtualLiquidityValueBasis:
      "stateview-active-liquidity-virtual-depth-usd";
    tokenPriceEthWei: string;
    tokenPriceUsdWad: string;
    totalSupplyRaw: string;
    tokenDecimals: number;
    fdvUsdWad: string;
    ethUsdQuote: Readonly<{
      feedAddress: `0x${string}`;
      roundId: string;
      answeredInRound: string;
      answer: string;
      decimals: number;
      updatedAt: string;
      updatedAtTime: string;
    }>;
  }>;
  grossVolumeEth?: string;
  grossVolumeWei?: string;
  creatorFeesGeneratedEth?: string;
  creatorFeesGeneratedWei?: string;
  launcherFeesGeneratedEth?: string;
  launcherFeesGeneratedWei?: string;
  creatorFeesAccruedEth?: string;
  creatorFeesAccruedWei?: string;
  growthFeesGeneratedEth?: string;
  growthFeesGeneratedWei?: string;
  growthFeesAccruedEth?: string;
  growthFeesAccruedWei?: string;
  swapCount?: number;
  currentTick?: number;
  initialTick?: number;
  tickLower?: number;
  tickUpper?: number;
  activeLiquidity?: string;
  protocolFeePips?: number;
  lpFeePips?: number;
  buyHookFeeBps?: number;
  sellHookFeeBps?: number;
  creatorFeeBps?: number;
  buyCreatorFeeBps?: number;
  sellCreatorFeeBps?: number;
  growthFeeBps?: number;
  programmableFeeBps?: number;
  launcherFeeBps?: number;
  transferTaxBps?: number;
  totalSwapFeeBps: number | null;
  launchModel?:
    | "classic"
    | "adaptive"
    | "deep"
    | "stock-paired"
    | "custom-graph";
  launchModelVersion?:
    | "classic-v2"
    | "classic-v3"
    | "classic-v4"
    | "stock-paired-v1"
    | "stock-paired-v2"
    | "stock-paired-v3"
    | "programmable-launch-stamp-router-v1";
  deepReleaseVersion?:
    "deep-full-range-v1" | "deep-full-range-v2" | "deep-full-range-v3";
  adaptiveCurveHash?: `0x${string}`;
  adaptiveCurvePoints?: {
    fdvIndex: number;
    totalSwapFeeBps: number;
  }[];
  adaptiveUsesPreSwapTick?: boolean;
  adaptiveSymmetricBuyAndSell?: boolean;
  growthVaultAddress?: `0x${string}`;
  oracleGuardAddress?: `0x${string}`;
  upstreamRewardVaultAddress?: `0x${string}`;
  growthTargetNativeWei?: string;
  completionToleranceNativeWei?: string;
  minimumNativeLiquidityForCompletionWei?: string;
  tokenReserveRaw?: string;
  totalNativeAllocatedToGrowthWei?: string;
  totalNativeAddedToLiquidityWei?: string;
  totalTokenAddedToLiquidityRaw?: string;
  totalGrowthEthReceivedWei?: string;
  totalNativeSwappedWei?: string;
  totalTokenAcquiredRaw?: string;
  pendingGrowthNativeWei?: string;
  deferredRewardFeesWei?: string;
  growthTargetReached?: boolean;
  oracleReady?: boolean;
  automationAction?: 0 | 1 | 2 | 3;
  nextCompoundTimestamp?: string;
  trustedNativeDepthWei?: string;
  depthCapNativeWei?: string;
  lockedLiquidity?: string;
  rollingExposureWei?: string;
  compoundCount?: string;
  lastCompoundTimestamp?: string;
  automationGuaranteed?: false;
  deepV2Provenance?: DeepV2IndexedLaunchProvenance;
  deepV3Provenance?: DeepV3IndexedLaunchProvenance;
  launchStampProvenance?: LaunchStampProvenanceV1;
  platformFeePolicy?: PlatformFeePolicyReadbackV2;
  uniswapV4Pool?: {
    source: "official-uniswap-v4-subgraph";
    indexedBlockNumber: string;
    indexedBlockHash: `0x${string}`;
    volumeUsdWad: string;
    tvlUsdWad: string;
    transactionCount: string;
    liquidity: string;
    sqrtPriceX96: string;
    tick?: number;
    feeTierPips: string;
  };
  liquidityPath: "meme" | "programmable-v4";
  metadataExtraData?: `0x${string}`;
  partnerAttribution?: LaunchPartnerAttributionV1;
};

export type CanonicalTokenExploreEntry = LauncherToken & Readonly<{
  exploreKind: "token";
  launchCategoryProvenance:
    | Extract<
        ExploreLaunchCategoryProvenance,
        { category: "classic" }
      >
    | Extract<
        ExploreLaunchCategoryProvenance,
        { source: "canonical-launch-stamp-router" }
      >;
}>;

export type CustomProjectExploreEntry = Readonly<{
  exploreKind: "custom-project";
  id: string;
  name: string;
  symbol?: string;
  description?: string;
  imageUrl?: string;
  links: readonly TokenLink[];
  launchedAt: string;
  finalizedAt: string;
  chainId: string;
  modelId: string;
  customProjectId: `sha256:${string}`;
  customLaunchId: `sha256:${string}`;
  launchingWallet: Readonly<{ namespace: string; value: string }>;
  postLaunchAuthorityInventory: Readonly<PostLaunchAuthorityInventoryV1>;
  postLaunchAuthorityInventoryHash: `sha256:${string}`;
  tokenAddress?: `0x${string}`;
  tokenDecimals?: number;
  totalSupplyRaw?: string;
  markets: readonly Readonly<{
    marketId: string;
    kind: string;
    status: "active" | "paused" | "closed" | "verification_pending";
    poolId?: `0x${string}`;
    baseAsset: Readonly<{
      assetId: string;
      identity: Readonly<{ namespace: string; value: string }>;
      name?: string;
      symbol?: string;
      decimals?: number;
    }>;
    quoteAsset: Readonly<{
      assetId: string;
      identity: Readonly<{ namespace: string; value: string }>;
      name?: string;
      symbol?: string;
      decimals?: number;
    }>;
    tradeCapability?: Readonly<DiscoverableMarketTradeCapabilityV1>;
  }>[];
  launchCategoryProvenance: Extract<
    ExploreLaunchCategoryProvenance,
    { category: "custom" }
  >;
  partnerAttribution?: LaunchPartnerAttributionV1;
}>;

export type ExploreEntry = CanonicalTokenExploreEntry | CustomProjectExploreEntry;

/**
 * Static tokens are deliberately empty. Explore must only render records
 * proven by the configured launcher events through the onchain API.
 */
export const launcherTokens: LauncherToken[] = [];

export type PreviewToken = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  tokenAddress: `0x${string}`;
  launchedAt: string;
  marketCapUsd: number;
  tone: TokenTone;
  linkKinds: TokenLinkKind[];
};

/**
 * Kept for the current card adapter, but intentionally empty so an undeployed
 * production registry never looks as if tokens already exist.
 */
export const previewTokens: PreviewToken[] = [];
import type {
  DiscoverableMarketTradeCapabilityV1,
  PostLaunchAuthorityInventoryV1,
} from "./custom-launch/contract-v2";
