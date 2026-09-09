import { isRobinhoodModuleLaunch, ROBINHOOD_PROFILE_PAGE_SIZE, type RobinhoodProfileLaunchList } from "@/lib/robinhood-launches";
import { isRobinhoodProjectedLaunch } from "@/lib/custom-launch/launch-projection-v1";

const ADDRESS = /^0x[\da-f]{40}$/i;
const HASH = /^0x[\da-f]{64}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => value === null || (typeof value === "string" && value.length <= 128);

export function readRobinhoodProfileResponse(value: unknown, account: string): RobinhoodProfileLaunchList {
  if (!record(value) || value.chainId !== 4663 || !ADDRESS.test(account)
    || value.account !== account.toLowerCase()
    || !["ready", "syncing", "stale", "unavailable"].includes(String(value.status))
    || !(value.updatedAt === null || (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))))
    || !Array.isArray(value.items) || value.items.length > ROBINHOOD_PROFILE_PAGE_SIZE || !record(value.page)) {
    throw new Error("Invalid Robinhood profile");
  }
  const tokens = new Set<string>();
  for (const row of value.items) {
    if (!record(row) || typeof row.creator !== "string" || row.creator.toLowerCase() !== account.toLowerCase()
      || typeof row.tokenAddress !== "string" || !ADDRESS.test(row.tokenAddress)
      || typeof row.launchId !== "string" || (!HASH.test(row.launchId) && !isRobinhoodProjectedLaunch(row))
      || !text(row.name) || !text(row.symbol)
      || !(row.launchedAt === null || (typeof row.launchedAt === "string" && Number.isFinite(Date.parse(row.launchedAt))))
      || (row.sourceKind !== undefined && !isRobinhoodModuleLaunch(row) && !isRobinhoodProjectedLaunch(row))
      || tokens.has(row.launchProjection ? `${row.sourceKind}:${row.launchId}` : row.tokenAddress.toLowerCase())) throw new Error("Invalid profile launch");
    tokens.add(row.launchProjection ? `${row.sourceKind}:${row.launchId}` : row.tokenAddress.toLowerCase());
  }
  const page = value.page;
  if (!Number.isSafeInteger(page.number) || Number(page.number) < 1 || page.size !== ROBINHOOD_PROFILE_PAGE_SIZE
    || !Number.isSafeInteger(page.totalItems) || Number(page.totalItems) < value.items.length
    || !Number.isSafeInteger(page.totalPages) || Number(page.totalPages) < 0
    || page.totalPages !== Math.ceil(Number(page.totalItems) / ROBINHOOD_PROFILE_PAGE_SIZE)
    || Number(page.number) > Math.max(1, Number(page.totalPages))
    || value.items.length !== Math.min(ROBINHOOD_PROFILE_PAGE_SIZE,
      Number(page.totalItems) - (Number(page.number) - 1) * ROBINHOOD_PROFILE_PAGE_SIZE)
    || page.hasMore !== (Number(page.number) < Number(page.totalPages))) throw new Error("Invalid profile page");
  return value as RobinhoodProfileLaunchList;
}
