import { readRobinhoodLaunches } from "@/lib/server/robinhood-index/read";
import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseRobinhoodExploreQuery(new URL(request.url).searchParams);
  if (!query) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  return Response.json(await readRobinhoodLaunches(query.page, query.q, query.filters, query.pageSize), { headers: {
    "cache-control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    "x-content-type-options": "nosniff",
  } });
}
