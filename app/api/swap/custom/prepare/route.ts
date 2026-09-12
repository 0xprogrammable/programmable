import { LaunchPlanTradeErrorV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { prepareCustomV4Swap } from "@/lib/server/swap/custom-v4";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return json({ code: "REQUEST_TOO_LARGE", error: "The swap request is too large." }, 413);
  let input: unknown;
  try { const text = await request.text(); if (new TextEncoder().encode(text).length > 4096) return json({ code: "REQUEST_TOO_LARGE", error: "The swap request is too large." }, 413); input = JSON.parse(text); }
  catch { return json({ code: "INVALID_REQUEST", error: "Send a valid swap request." }, 400); }
  try { return json(await prepareCustomV4Swap(input)); }
  catch (error) {
    if (error instanceof LaunchPlanTradeErrorV1) return json({ code: error.code, error: error.message }, error.status);
    return json({ code: "SWAP_UNAVAILABLE", error: "The swap could not be checked. Please try again." }, 503);
  }
}
