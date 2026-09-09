import { readRobinhoodLaunches } from "@/lib/server/robinhood-index/read";
import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseRobinhoodExploreQuery(new URL(request.url).searchParams);
  if (!query) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const result = await readRobinhoodLaunches(query.page, query.q, query.filters, query.pageSize);
  return Response.json(result, { status: result.status === "unavailable" ? 503 : 200, headers: {
    "cache-control": result.status === "ready" ? "public, max-age=0, s-maxage=15, stale-while-revalidate=30" : "no-store",
    "x-programmable-indexing-status": result.status,
    "x-content-type-options": "nosniff",
  } });
}
