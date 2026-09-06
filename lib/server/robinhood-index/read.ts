import "server-only";
import { unstable_cache } from "next/cache";
import { DEFAULT_EXPLORE_FILTERS, type RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";
import { isVisibleRobinhoodToken } from "@/lib/robinhood-explore-policy";
import { readRobinhoodMarkets, readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";
import type { RobinhoodCoinMarket, RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { launchList, profileLaunchList, snapshotLaunches } from "./model";
import { indexStore } from "./store";

// A page reads the saved list only. Failures never fall through to an RPC.
const readSnapshot = unstable_cache(async () => (await indexStore().read())?.snapshot ?? null,
  ["robinhood-website-index-v1"], { revalidate: 15 });

export async function readRobinhoodLaunches(page = 1, query = "", filters: RobinhoodExploreFilters = DEFAULT_EXPLORE_FILTERS) {
  try {
    const snapshot = await readSnapshot();
    const visible = snapshotLaunches(snapshot).filter((token) => isVisibleRobinhoodToken(token.tokenAddress));
    const markets = await readRobinhoodMarkets(visible).catch(() => new Map<string, RobinhoodCoinMarket>());
    const caps = new Map(Array.from(markets).flatMap(([address, market]) => market.marketCapUsd === null ? [] : [[address, market.marketCapUsd] as const]));
    const list = launchList(snapshot, page, query, Date.now(), filters, caps);
    // Ranking and card values use the same full-catalog market observation.
    return { ...list, presentations: await readRobinhoodPresentations(list.items, markets) };
  } catch { return { ...launchList(null, page, query, Date.now(), filters), presentations: [] as RobinhoodCoinPresentation[] }; }
}

export async function readRobinhoodToken(address: string) {
  try {
    const snapshot = await readSnapshot();
    const list = launchList(snapshot);
    return {
      status: list.status,
      updatedAt: list.updatedAt,
      token: snapshotLaunches(snapshot).find((row) => row.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null,
    };
  } catch { return { status: "unavailable" as const, updatedAt: null, token: null }; }
}

export async function readRobinhoodProfileLaunches(account: string, page = 1) {
  const unavailable = profileLaunchList(null, account, page);
  try { return profileLaunchList(await readSnapshot(), unavailable.account, page); }
  catch { return unavailable; }
}
