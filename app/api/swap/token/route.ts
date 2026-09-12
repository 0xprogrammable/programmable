import { resolveSwapToken } from "@/lib/server/swap/token";
import { SwapUnavailableError, type SwapChainId } from "@/lib/swap/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams, address = query.get("address") ?? query.get("token") ?? "", chain = query.get("chain") ?? "4663";
  if (!["1", "4663"].includes(chain) || [...query.keys()].some(key => !["address", "token", "chain"].includes(key))) return json({ error: "Select Ethereum or Robinhood Chain.", code: "INVALID_REQUEST" }, 400);
  try { return json(await resolveSwapToken({ address, chainId: Number(chain) as SwapChainId })); }
  catch (error) {
    if (error instanceof SwapUnavailableError) return json({ error: error.message, code: error.code }, ["INVALID_ADDRESS", "INVALID_CHAIN", "NOT_PRIMARY_TOKEN"].includes(error.code) ? 400 : error.code === "TOKEN_NOT_FOUND" ? 404 : 503);
    return json({ error: "The token’s trading route is temporarily unavailable. Try again.", code: "ROUTE_UNAVAILABLE" }, 503);
  }
}
