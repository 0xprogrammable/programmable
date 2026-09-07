import { MODULE_MODE_ECONOMICS_POLICY_V2 } from "./module-mode/release";

export type RobinhoodLaunch = Readonly<{
  routerAddress: string | null;
  launchId: string;
  tokenAddress: string;
  hookAddress: string | null;
  creator: string;
  poolManager: string | null;
  poolId: string | null;
  stampHash: string | null;
  sourceKind?: "module-native-v1" | "module-native-v2" | "module-engine-v1";
  sourceAddress?: string;
  sourceReleaseDigest?: string;
  recipeHash?: string;
  runtime?: string;
  launchKey?: string;
  verificationDigest?: string;
  modulePackageIds?: readonly string[];
  moduleFamilyIds?: readonly string[];
  economicsPolicyId?: string;
  protocolFeeBps?: 10;
  authorPoolFeeBps?: 0 | 20;
  platformFeeBps?: 10 | 30;
  feeEligibleFamilyIds?: readonly string[];
  engineAddress?: string;
  engineRevisionId?: string;
  engineFamilyId?: string;
  engineManifestHash?: string;
  engineRuntimeCodeHash?: string;
  tokenRuntimeCodeHash?: string;
  quoteAsset?: string;
  quoteDecimals?: number;
  configurationHash?: string;
  constructorHash?: string;
  initCodeHash?: string;
  planHash?: string;
  resourcesHash?: string;
  primaryMarket?: RobinhoodEnginePrimaryMarket | null;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
  launchedAt: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}>;

export type RobinhoodLaunchList = Readonly<{
  chainId: 4663;
  status: "ready" | "syncing" | "stale" | "unavailable";
  updatedAt: string | null;
  items: readonly RobinhoodLaunch[];
  page: Readonly<{
    number: number;
    size: 10 | 50;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  }>;
}>;

export type RobinhoodProfileLaunchList = RobinhoodLaunchList & Readonly<{
  account: string;
}>;

/** Module Mode is a separate canonical source; it never receives a fabricated Router stamp. */
export type RobinhoodNativeModuleLaunch = RobinhoodLaunch & Readonly<{
  hookAddress: string; poolManager: string; poolId: string;
  sourceKind: "module-native-v1" | "module-native-v2";
  routerAddress: null;
  stampHash: null;
  sourceAddress: string;
  sourceReleaseDigest: string;
  recipeHash: string;
  runtime: string;
  launchKey: string;
  verificationDigest: string;
  modulePackageIds: readonly string[];
  moduleFamilyIds: readonly string[];
}>;

export function isRobinhoodModuleSourceKind(value: unknown): value is NonNullable<RobinhoodLaunch["sourceKind"]> {
  return value === "module-native-v1" || value === "module-native-v2" || value === "module-engine-v1";
}

/**
 * Structural guard for data already delivered by the canonical saved index. This is not a provider,
 * finality or source-authentication check, and it must never promote a wallet receipt into that index.
 */
export function isRobinhoodNativeModuleLaunch(value: unknown): value is RobinhoodNativeModuleLaunch {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const address = (item: unknown): item is string => typeof item === "string" && /^0x(?!0{40}$)[\da-f]{40}$/i.test(item);
  const hash = (item: unknown): item is string => typeof item === "string" && /^0x(?!0{64}$)[\da-f]{64}$/i.test(item);
  if (row.sourceKind !== "module-native-v1" && row.sourceKind !== "module-native-v2") return false;
  const economics = row.sourceKind === "module-native-v1"
    ? ["economicsPolicyId", "protocolFeeBps", "authorPoolFeeBps", "platformFeeBps", "feeEligibleFamilyIds"].every(key => !Object.hasOwn(row, key))
    : row.economicsPolicyId === MODULE_MODE_ECONOMICS_POLICY_V2 && row.protocolFeeBps === 10 && (row.authorPoolFeeBps === 0 || row.authorPoolFeeBps === 20)
      && row.platformFeeBps === 10 + Number(row.authorPoolFeeBps) && Array.isArray(row.feeEligibleFamilyIds)
      && row.feeEligibleFamilyIds.length <= 8 && row.feeEligibleFamilyIds.every(hash)
      && row.authorPoolFeeBps === (row.feeEligibleFamilyIds.length ? 20 : 0)
      && row.feeEligibleFamilyIds.every((id, index, ids) => (index === 0 || id.toLowerCase() > ids[index - 1].toLowerCase())
        && Array.isArray(row.moduleFamilyIds) && row.moduleFamilyIds.some(family => typeof family === "string" && family.toLowerCase() === id.toLowerCase()));
  return economics && row.routerAddress === null && row.stampHash === null
    && [row.sourceAddress, row.tokenAddress, row.hookAddress, row.creator, row.poolManager, row.runtime].every(address)
    && [row.launchId, row.sourceReleaseDigest, row.recipeHash, row.poolId, row.launchKey, row.verificationDigest, row.transactionHash, row.blockHash].every(hash)
    && typeof row.blockNumber === "string" && /^(0|[1-9][0-9]*)$/.test(row.blockNumber)
    && Number.isSafeInteger(row.logIndex) && Number(row.logIndex) >= 0
    && row.decimals === 18 && [row.name, row.symbol].every(item => typeof item === "string" && item.length > 0 && item.length <= 128)
    && (row.launchedAt === null || (typeof row.launchedAt === "string" && Number.isFinite(Date.parse(row.launchedAt))))
    && Array.isArray(row.modulePackageIds) && Array.isArray(row.moduleFamilyIds)
    && row.modulePackageIds.length <= 16 && row.modulePackageIds.length === row.moduleFamilyIds.length
    && row.modulePackageIds.every(hash) && row.moduleFamilyIds.every(hash)
    && (row.sourceKind === "module-native-v2" || (new Set(row.modulePackageIds.map(id => id.toLowerCase())).size === row.modulePackageIds.length
      && row.moduleFamilyIds.every((id, index, ids) => index === 0 || id.toLowerCase() > ids[index - 1].toLowerCase())));
}

export type RobinhoodEnginePrimaryMarket = Readonly<{ kind: "uniswap-v4"; chainId: 4663; launchId: string; poolManager: string;
  poolId: string; quoteAsset: string; primaryToken: string; hook: string; initialTick: number }>;
export type RobinhoodEngineLaunch = RobinhoodLaunch & Readonly<{
  sourceKind: "module-engine-v1"; routerAddress: null; stampHash: null; sourceAddress: string; sourceReleaseDigest: string;
  engineAddress: string; engineRevisionId: string; engineFamilyId: string; engineManifestHash: string; engineRuntimeCodeHash: string;
  tokenRuntimeCodeHash: string; quoteAsset: string; quoteDecimals: number; configurationHash: string; constructorHash: string;
  initCodeHash: string; planHash: string; resourcesHash: string; verificationDigest: string;
  economicsPolicyId: string; protocolFeeBps: 10; authorPoolFeeBps: 0 | 20; platformFeeBps: 10 | 30; feeEligibleFamilyIds: readonly string[];
  modulePackageIds: readonly string[]; moduleFamilyIds: readonly string[]; primaryMarket: RobinhoodEnginePrimaryMarket | null;
}>;
export type RobinhoodModuleLaunch = RobinhoodNativeModuleLaunch | RobinhoodEngineLaunch;

/** Structural validation only, after independent source and finality verification by the saved index. */
export function isRobinhoodEngineLaunch(value: unknown): value is RobinhoodEngineLaunch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const address = (item: unknown): item is string => typeof item === "string" && /^0x(?!0{40}$)[\da-f]{40}$/i.test(item);
  const hash = (item: unknown): item is string => typeof item === "string" && /^0x(?!0{64}$)[\da-f]{64}$/i.test(item);
  if (row.sourceKind !== "module-engine-v1" || row.routerAddress !== null || row.stampHash !== null
    || ["recipeHash", "runtime", "launchKey"].some(key => Object.hasOwn(row, key))
    || ![row.sourceAddress, row.tokenAddress, row.creator, row.engineAddress, row.quoteAsset].every(address)
    || row.tokenAddress === row.quoteAsset
    || ![row.launchId, row.sourceReleaseDigest, row.engineRevisionId, row.engineFamilyId, row.engineManifestHash, row.engineRuntimeCodeHash,
      row.tokenRuntimeCodeHash, row.configurationHash, row.constructorHash, row.initCodeHash, row.planHash, row.resourcesHash,
      row.verificationDigest, row.transactionHash, row.blockHash].every(hash)
    || !Number.isInteger(row.quoteDecimals) || Number(row.quoteDecimals) < 0 || Number(row.quoteDecimals) > 18
    || row.decimals !== 18 || ![row.name, row.symbol].every(item => typeof item === "string" && item.length > 0 && item.length <= 128)
    || typeof row.blockNumber !== "string" || !/^(0|[1-9][0-9]*)$/.test(row.blockNumber)
    || !Number.isSafeInteger(row.logIndex) || Number(row.logIndex) < 0
    || !(row.launchedAt === null || (typeof row.launchedAt === "string" && Number.isFinite(Date.parse(row.launchedAt))))
    || !Array.isArray(row.modulePackageIds) || row.modulePackageIds.length !== 1 || row.modulePackageIds[0] !== row.engineRevisionId
    || !Array.isArray(row.moduleFamilyIds) || row.moduleFamilyIds.length !== 1 || row.moduleFamilyIds[0] !== row.engineFamilyId
    || row.economicsPolicyId !== MODULE_MODE_ECONOMICS_POLICY_V2 || row.protocolFeeBps !== 10
    || (row.authorPoolFeeBps !== 0 && row.authorPoolFeeBps !== 20) || row.platformFeeBps !== 10 + Number(row.authorPoolFeeBps)
    || !Array.isArray(row.feeEligibleFamilyIds) || row.feeEligibleFamilyIds.length > 8 || !row.feeEligibleFamilyIds.every(hash)
    || row.authorPoolFeeBps !== (row.feeEligibleFamilyIds.length ? 20 : 0)
    || row.feeEligibleFamilyIds.some((id, index, ids) => index > 0 && id.toLowerCase() <= ids[index - 1].toLowerCase())) return false;
  if (row.primaryMarket === null) return row.hookAddress === null && row.poolManager === null && row.poolId === null;
  if (!row.primaryMarket || typeof row.primaryMarket !== "object" || Array.isArray(row.primaryMarket)) return false;
  const market = row.primaryMarket as Record<string, unknown>;
  return market.kind === "uniswap-v4" && market.chainId === 4663 && market.launchId === row.launchId
    && market.primaryToken === row.tokenAddress && market.quoteAsset === row.quoteAsset && market.hook === row.engineAddress
    && address(market.poolManager) && hash(market.poolId) && row.poolManager === market.poolManager && row.poolId === market.poolId
    && row.hookAddress === market.hook && Number.isInteger(market.initialTick) && Math.abs(Number(market.initialTick)) < 887272;
}

export function isRobinhoodModuleLaunch(value: unknown): value is RobinhoodModuleLaunch {
  return isRobinhoodNativeModuleLaunch(value) || isRobinhoodEngineLaunch(value);
}

export function robinhoodLaunchDescription(launch: RobinhoodLaunch): string {
  return isRobinhoodModuleLaunch(launch)
    ? "Programmable Module Mode launch on Robinhood Chain. Explore the coin, its modules and management controls."
    : "Programmable Custom launch on Robinhood Chain. Token, hook and launch stamp details.";
}

export function robinhoodModuleManageHref(launch: RobinhoodLaunch): string | null {
  return isRobinhoodModuleLaunch(launch) ? `/launch/modules/manage/${launch.tokenAddress.toLowerCase()}?${launch.sourceKind === "module-engine-v1" ? "sourceKind=module-engine-v1&" : ""}releaseDigest=${launch.sourceReleaseDigest.toLowerCase()}` : null;
}
