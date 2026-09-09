import { isAddress } from "viem";

import { readRobinhoodProfileLaunches } from "@/lib/server/robinhood-index/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (request.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: {
      "allow": "GET", "cache-control": "no-store", "x-content-type-options": "nosniff",
    } });
  }
  const query = new URL(request.url).searchParams;
  const account = query.get("account");
  const page = query.get("page") ?? "1";
  const pageSize = query.get("pageSize") ?? "50";
  if ([...query.keys()].some((key) => !["account", "page", "pageSize"].includes(key) || query.getAll(key).length !== 1)
    || (pageSize !== "5" && pageSize !== "50")
    || account === null || !isAddress(account) || !/^[1-9]\d{0,5}$/.test(page)) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: {
      "cache-control": "no-store", "x-content-type-options": "nosniff",
    } });
  }
  return Response.json(await readRobinhoodProfileLaunches(account.toLowerCase(), Number(page), pageSize === "5" ? 5 : 50), { headers: {
    "cache-control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    "x-content-type-options": "nosniff",
  } });
}
