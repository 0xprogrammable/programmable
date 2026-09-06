export type RobinhoodLaunch = Readonly<{
  routerAddress: string | null;
  launchId: string;
  tokenAddress: string;
  hookAddress: string;
  creator: string;
  poolManager: string;
  poolId: string;
  stampHash: string | null;
  sourceKind?: "module-native-v1";
  sourceAddress?: string;
  sourceReleaseDigest?: string;
  recipeHash?: string;
  runtime?: string;
  launchKey?: string;
  verificationDigest?: string;
  modulePackageIds?: readonly string[];
  moduleFamilyIds?: readonly string[];
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
    size: 50;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  }>;
}>;

export type RobinhoodProfileLaunchList = RobinhoodLaunchList & Readonly<{
  account: string;
}>;

/** Module Mode is a separate canonical source; it never receives a fabricated Router stamp. */
export type RobinhoodModuleLaunch = RobinhoodLaunch & Readonly<{
  sourceKind: "module-native-v1";
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

/**
 * Structural guard for data already delivered by the canonical saved index. This is not a provider,
 * finality or source-authentication check, and it must never promote a wallet receipt into that index.
 */
export function isRobinhoodModuleLaunch(value: unknown): value is RobinhoodModuleLaunch {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const address = (item: unknown): item is string => typeof item === "string" && /^0x(?!0{40}$)[\da-f]{40}$/i.test(item);
  const hash = (item: unknown): item is string => typeof item === "string" && /^0x(?!0{64}$)[\da-f]{64}$/i.test(item);
  return row.sourceKind === "module-native-v1" && row.routerAddress === null && row.stampHash === null
    && [row.sourceAddress, row.tokenAddress, row.hookAddress, row.creator, row.poolManager, row.runtime].every(address)
    && [row.launchId, row.sourceReleaseDigest, row.recipeHash, row.poolId, row.launchKey, row.verificationDigest, row.transactionHash, row.blockHash].every(hash)
    && typeof row.blockNumber === "string" && /^(0|[1-9][0-9]*)$/.test(row.blockNumber)
    && Number.isSafeInteger(row.logIndex) && Number(row.logIndex) >= 0
    && row.decimals === 18 && [row.name, row.symbol].every(item => typeof item === "string" && item.length > 0 && item.length <= 128)
    && (row.launchedAt === null || (typeof row.launchedAt === "string" && Number.isFinite(Date.parse(row.launchedAt))))
    && Array.isArray(row.modulePackageIds) && Array.isArray(row.moduleFamilyIds)
    && row.modulePackageIds.length <= 16 && row.modulePackageIds.length === row.moduleFamilyIds.length
    && row.modulePackageIds.every(hash) && row.moduleFamilyIds.every(hash)
    && new Set(row.modulePackageIds.map(id => id.toLowerCase())).size === row.modulePackageIds.length
    && row.moduleFamilyIds.every((id, index, ids) => index === 0 || id.toLowerCase() > ids[index - 1].toLowerCase());
}

export function robinhoodLaunchDescription(launch: RobinhoodLaunch): string {
  return isRobinhoodModuleLaunch(launch)
    ? "Programmable Module Mode launch on Robinhood Chain. Explore the coin, its modules and management controls."
    : "Programmable Custom launch on Robinhood Chain. Token, hook and launch stamp details.";
}

export function robinhoodModuleManageHref(launch: RobinhoodLaunch): string | null {
  return isRobinhoodModuleLaunch(launch) ? `/launch/modules/manage/${launch.tokenAddress.toLowerCase()}` : null;
}
