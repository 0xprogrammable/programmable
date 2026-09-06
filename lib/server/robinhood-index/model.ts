import type { RobinhoodLaunch, RobinhoodModuleLaunch, RobinhoodLaunchList, RobinhoodProfileLaunchList } from "@/lib/robinhood-launches";
import { DEFAULT_EXPLORE_FILTERS, type RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";
import { isPinnedRobinhoodToken, isVisibleRobinhoodToken } from "@/lib/robinhood-explore-policy";

export type Checkpoint = { number: string; hash: string };
export type RobinhoodSnapshot = {
  version: 1;
  chainId: 4663;
  routerAddress: string;
  binding: string;
  startBlock: string;
  cursor: Checkpoint | null;
  checkpoints: Checkpoint[];
  finalizedBlock: string;
  updatedAt: string;
  items: RobinhoodLaunch[];
  pending?: { block: Checkpoint; items: RobinhoodLaunch[] } | null;
  moduleMode?: ModuleModeSnapshot | null;
};

export type ModuleModeSnapshot = {
  version: 1;
  sourceKind: "module-native-v1";
  chainId: 4663;
  sourceAddress: string;
  releaseDigest: string;
  startBlock: string;
  cursor: Checkpoint | null;
  checkpoints: Checkpoint[];
  finalizedBlock: string;
  updatedAt: string;
  items: RobinhoodModuleLaunch[];
  pending?: { block: Checkpoint; items: RobinhoodModuleLaunch[] } | null;
};

const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const BLOCK = /^(0|[1-9]\d{0,19})$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const checkpoint = (value: unknown): value is Checkpoint =>
  isObject(value) && matches(value.number, BLOCK) && matches(value.hash, HASH);

export function parseSnapshot(value: unknown): RobinhoodSnapshot {
  if (!isObject(value) || value.version !== 1 || value.chainId !== 4663
    || !matches(value.routerAddress, ADDRESS) || !matches(value.binding, HASH)
    || !matches(value.startBlock, BLOCK) || !matches(value.finalizedBlock, BLOCK)
    || !date(value.updatedAt) || !(value.cursor === null || checkpoint(value.cursor))
    || !Array.isArray(value.checkpoints) || value.checkpoints.length > 16
    || !value.checkpoints.every(checkpoint) || !Array.isArray(value.items)
    || value.items.length > 10_000) throw new Error("Invalid Robinhood index");
  const ids = new Set<string>();
  const tokens = new Set<string>();
  for (const row of value.items) {
    if (!isObject(row) || row.sourceKind !== undefined
      || !["routerAddress", "tokenAddress", "hookAddress", "creator", "poolManager"].every((key) => matches(row[key], ADDRESS))
      || !["launchId", "poolId", "stampHash", "transactionHash", "blockHash"].every((key) => matches(row[key], HASH))
      || String(row.routerAddress).toLowerCase() !== value.routerAddress.toLowerCase()
      || !matches(row.blockNumber, BLOCK) || !Number.isSafeInteger(row.logIndex) || Number(row.logIndex) < 0
      || !(row.launchedAt === null || date(row.launchedAt))
      || !["name", "symbol"].every((key) => row[key] === null || (typeof row[key] === "string" && row[key].length <= 128))
      || !(row.decimals === null || (Number.isInteger(row.decimals) && Number(row.decimals) >= 0 && Number(row.decimals) <= 255))
      || value.cursor === null || BigInt(row.blockNumber) > BigInt(value.cursor.number)
      || BigInt(row.blockNumber) < BigInt(value.startBlock)) throw new Error("Invalid Robinhood launch");
    const id = String(row.launchId).toLowerCase();
    const token = String(row.tokenAddress).toLowerCase();
    if (ids.has(id) || tokens.has(token)) throw new Error("Duplicate Robinhood launch");
    ids.add(id);
    tokens.add(token);
  }
  const cursor = value.cursor;
  if (cursor && (BigInt(cursor.number) > BigInt(value.finalizedBlock)
    || value.checkpoints.some((point) => BigInt(point.number) > BigInt(cursor.number)))) {
    throw new Error("Invalid Robinhood checkpoint");
  }
  if (value.pending != null) {
    const pending = asPending(value.pending);
    if (BigInt(pending.block.number) > BigInt(value.finalizedBlock)
      || pending.items.some((row) => row.blockNumber !== pending.block.number || row.blockHash !== pending.block.hash)) {
      throw new Error("Invalid pending block");
    }
    parseSnapshot({ ...value, pending: null, cursor: pending.block, checkpoints: [], items: pending.items });
  }
  if (value.moduleMode != null) {
    const modules = parseModuleModeSnapshot(value.moduleMode);
    const pools = new Set((value.items as RobinhoodLaunch[]).map(row => `${row.poolManager.toLowerCase()}:${row.poolId.toLowerCase()}`));
    for (const row of modules.items) {
      const pool = `${row.poolManager.toLowerCase()}:${row.poolId.toLowerCase()}`;
      if (tokens.has(row.tokenAddress.toLowerCase()) || pools.has(pool)) throw new Error("Duplicate cross-source Robinhood launch");
    }
  }
  return value as RobinhoodSnapshot;
}

export function parseModuleModeSnapshot(value: unknown): ModuleModeSnapshot {
  if (!isObject(value) || value.version !== 1 || value.sourceKind !== "module-native-v1" || value.chainId !== 4663
    || !matches(value.sourceAddress, ADDRESS) || /^0x0{40}$/i.test(value.sourceAddress)
    || !matches(value.releaseDigest, HASH) || /^0x0{64}$/i.test(value.releaseDigest)
    || !matches(value.startBlock, BLOCK) || !matches(value.finalizedBlock, BLOCK) || !date(value.updatedAt)
    || !(value.cursor === null || checkpoint(value.cursor)) || !Array.isArray(value.checkpoints)
    || value.checkpoints.length > 16 || !value.checkpoints.every(checkpoint)
    || !Array.isArray(value.items) || value.items.length > 10_000) throw new Error("Invalid Module Mode index");
  const identities = [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>()];
  for (const row of value.items) {
    if (!isObject(row) || row.sourceKind !== "module-native-v1" || row.routerAddress !== null || row.stampHash !== null
      || !["sourceAddress", "tokenAddress", "hookAddress", "creator", "poolManager", "runtime"].every(key => matches(row[key], ADDRESS) && !/^0x0{40}$/i.test(String(row[key])))
      || !["sourceReleaseDigest", "launchId", "poolId", "recipeHash", "launchKey", "transactionHash", "blockHash", "verificationDigest"].every(key => matches(row[key], HASH) && !/^0x0{64}$/i.test(String(row[key])))
      || String(row.sourceAddress).toLowerCase() !== value.sourceAddress.toLowerCase()
      || String(row.sourceReleaseDigest).toLowerCase() !== value.releaseDigest.toLowerCase()
      || !matches(row.blockNumber, BLOCK) || !Number.isSafeInteger(row.logIndex) || Number(row.logIndex) < 0
      || !(row.launchedAt === null || date(row.launchedAt))
      || !["name", "symbol"].every(key => typeof row[key] === "string" && String(row[key]).length > 0 && String(row[key]).length <= 128)
      || row.decimals !== 18 || value.cursor === null || BigInt(row.blockNumber) > BigInt(value.cursor.number)
      || BigInt(row.blockNumber) < BigInt(value.startBlock)
      || !Array.isArray(row.modulePackageIds) || !Array.isArray(row.moduleFamilyIds)
      || row.modulePackageIds.length > 16 || row.modulePackageIds.length !== row.moduleFamilyIds.length
      || ![...row.modulePackageIds, ...row.moduleFamilyIds].every(id => matches(id, HASH) && !/^0x0{64}$/i.test(id))
      || new Set(row.modulePackageIds.map(id => id.toLowerCase())).size !== row.modulePackageIds.length
      || row.moduleFamilyIds.some((id, index, ids) => index > 0 && id.toLowerCase() <= ids[index - 1].toLowerCase())) {
      throw new Error("Invalid Module Mode launch");
    }
    const keys = [String(row.launchId), String(row.tokenAddress), `${row.poolManager}:${row.poolId}`, `${row.transactionHash}:${row.logIndex}`];
    keys.forEach((key, index) => { const id = key.toLowerCase(); if (identities[index].has(id)) throw new Error("Duplicate Module Mode launch"); identities[index].add(id); });
  }
  const cursor = value.cursor as Checkpoint | null;
  if (cursor && (BigInt(cursor.number) > BigInt(value.finalizedBlock)
    || value.checkpoints.some(point => BigInt(point.number) > BigInt(cursor.number)))) throw new Error("Invalid Module Mode checkpoint");
  if (value.pending != null) {
    const pending = asPending(value.pending);
    if (BigInt(pending.block.number) > BigInt(value.finalizedBlock)
      || pending.items.some(row => row.blockNumber !== pending.block.number || row.blockHash !== pending.block.hash)) throw new Error("Invalid pending Module Mode block");
    parseModuleModeSnapshot({ ...value, pending: null, cursor: pending.block, checkpoints: [], items: pending.items });
  }
  return value as ModuleModeSnapshot;
}

export function snapshotLaunches(snapshot: RobinhoodSnapshot | null): readonly RobinhoodLaunch[] {
  return [...(snapshot?.items ?? []), ...(snapshot?.moduleMode?.items ?? [])];
}
function snapshotStatus(snapshot: RobinhoodSnapshot | null, now: number): RobinhoodLaunchList["status"] {
  if (!snapshot) return "unavailable";
  const sources = [snapshot, ...(snapshot.moduleMode ? [snapshot.moduleMode] : [])];
  if (sources.some(source => now - Date.parse(source.updatedAt) > 300_000)) return "stale";
  return sources.some(source => source.pending || source.cursor?.number !== source.finalizedBlock) ? "syncing" : "ready";
}
function snapshotUpdatedAt(snapshot: RobinhoodSnapshot | null): string | null {
  if (!snapshot) return null;
  return snapshot.moduleMode && Date.parse(snapshot.moduleMode.updatedAt) < Date.parse(snapshot.updatedAt)
    ? snapshot.moduleMode.updatedAt : snapshot.updatedAt;
}

function asPending(value: unknown) {
  if (!isObject(value) || !checkpoint(value.block) || !Array.isArray(value.items) || value.items.length === 0) {
    throw new Error("Invalid pending block");
  }
  return value as { block: Checkpoint; items: RobinhoodLaunch[] };
}

export function launchList(snapshot: RobinhoodSnapshot | null, page = 1, query = "", now = Date.now(), filters: RobinhoodExploreFilters = DEFAULT_EXPLORE_FILTERS, marketCaps: ReadonlyMap<string, number> = new Map()): RobinhoodLaunchList {
  const q = query.trim().toLowerCase();
  const visible = snapshotLaunches(snapshot).filter((row) => isVisibleRobinhoodToken(row.tokenAddress));
  const pinned = visible.find((row) => isPinnedRobinhoodToken(row.tokenAddress));
  const cap = (address: string) => {
    const value = marketCaps.get(address.toLowerCase());
    return value != null && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const items = visible.filter((row) => row !== pinned && (!q
    || [row.name, row.symbol, row.tokenAddress, row.hookAddress].some((value) => value?.toLowerCase().includes(q))))
    .toSorted((a, b) => {
    if (filters.sort === "highest" || filters.sort === "lowest") {
      const aCap = cap(a.tokenAddress);
      const bCap = cap(b.tokenAddress);
      if (aCap === null && bCap !== null) return 1;
      if (bCap === null && aCap !== null) return -1;
      if (aCap !== null && bCap !== null && aCap !== bCap) return filters.sort === "highest" ? bCap - aCap : aCap - bCap;
    }
    const newest = BigInt(a.blockNumber) === BigInt(b.blockNumber)
      ? b.logIndex - a.logIndex : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1;
    return (filters.sort === "oldest" ? -newest : newest) || a.tokenAddress.toLowerCase().localeCompare(b.tokenAddress.toLowerCase());
  });
  // Reserve the first slot for the verified main token on every page and sort.
  const pageSize = pinned ? 49 : 50;
  const totalItems = items.length + Number(Boolean(pinned));
  const totalPages = Math.max(pinned ? 1 : 0, Math.ceil(items.length / pageSize));
  const number = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const status = snapshotStatus(snapshot, now);
  return {
    chainId: 4663, status, updatedAt: snapshotUpdatedAt(snapshot),
    items: [...(pinned ? [pinned] : []), ...items.slice((number - 1) * pageSize, number * pageSize)],
    page: { number, size: 50, totalItems, totalPages, hasMore: number < totalPages },
  };
}

// A profile shows the recorded launch wallet's history. Explore's display policy
// and market ranking do not change which canonical launches belong to that wallet.
export function profileLaunchList(snapshot: RobinhoodSnapshot | null, account: string, page = 1, now = Date.now()): RobinhoodProfileLaunchList {
  const normalizedAccount = account.toLowerCase();
  if (!ADDRESS.test(normalizedAccount)) throw new Error("Invalid Robinhood profile account");
  const items = snapshotLaunches(snapshot)
    .filter((row) => row.creator.toLowerCase() === normalizedAccount)
    .toSorted((a, b) => {
      const newest = BigInt(a.blockNumber) === BigInt(b.blockNumber)
        ? b.logIndex - a.logIndex : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1;
      return newest || a.tokenAddress.toLowerCase().localeCompare(b.tokenAddress.toLowerCase());
    });
  const totalPages = Math.ceil(items.length / 50);
  const requestedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const number = Math.min(requestedPage, Math.max(1, totalPages));
  const status = snapshotStatus(snapshot, now);
  return {
    chainId: 4663, account: normalizedAccount, status, updatedAt: snapshotUpdatedAt(snapshot),
    items: items.slice((number - 1) * 50, number * 50),
    page: { number, size: 50, totalItems: items.length, totalPages, hasMore: number < totalPages },
  };
}
