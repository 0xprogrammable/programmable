import { parseEthereumExploreQuery } from "@/lib/ethereum-explore";
import { readEthereumLaunches } from "@/lib/server/ethereum-explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseEthereumExploreQuery(new URL(request.url).searchParams);
  if (!query) return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  try {
    const result = await readEthereumLaunches(query.page, query.q, query.filters, query.pageSize);
    return Response.json(result, { status: result.status === "unavailable" ? 503 : 200, headers: {
      "cache-control": result.status === "ready" ? "public, max-age=0, s-maxage=15" : "no-store",
      "x-programmable-indexing-status": result.status,
      "x-content-type-options": "nosniff",
    } });
  } catch {
    return Response.json({ error: "Launches are temporarily unavailable", status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
