import { isAddress } from "viem";
import { readRobinhoodLaunches, readRobinhoodProfileLaunches, readRobinhoodToken } from "@/lib/server/robinhood-index/read";
import { readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";
import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const account = query.get("account");
  if (account !== null) {
    const page = query.get("page") ?? "1";
    const pageSize = query.get("pageSize") ?? "50";
    if (!isAddress(account) || !/^[1-9]\d{0,5}$/.test(page)
      || (pageSize !== "5" && pageSize !== "50")
      || [...query.keys()].some((key) => !["account", "page", "pageSize"].includes(key) || query.getAll(key).length !== 1)) {
      return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    const profile = await readRobinhoodProfileLaunches(account.toLowerCase(), Number(page), pageSize === "5" ? 5 : 50);
    const items = await readRobinhoodPresentations(profile.items);
    return Response.json({ items }, { headers: {
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
      "x-content-type-options": "nosniff",
    } });
  }
  const token = query.get("token");
  const listQuery = token === null ? parseRobinhoodExploreQuery(query) : null;
  if (token === null ? !listQuery : !isAddress(token)
    || [...query.keys()].some((key) => key !== "token" || query.getAll(key).length !== 1)) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const items = listQuery
    ? (await readRobinhoodLaunches(listQuery.page, listQuery.q, listQuery.filters, listQuery.pageSize)).presentations
    : await readRobinhoodPresentations([(await readRobinhoodToken(token!)).token].filter((row) => row !== null));
  return Response.json({ items }, { headers: {
    "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
    "x-content-type-options": "nosniff",
  } });
}
