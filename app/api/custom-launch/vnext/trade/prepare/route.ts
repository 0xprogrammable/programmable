import { NextRequest, NextResponse } from "next/server";
import { LaunchPlanTradeErrorV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { prepareLaunchPlanTradeV1 } from "@/lib/server/custom-launch/routed-trade-plan-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") ?? 0) > 12_000) return json({ code: "REQUEST_TOO_LARGE", error: "The trade request is too large." }, 413);
  let input: unknown;
  try { const text = await request.text(); if (new TextEncoder().encode(text).length > 12_000) return json({ code: "REQUEST_TOO_LARGE", error: "The trade request is too large." }, 413); input = JSON.parse(text); }
  catch { return json({ code: "INVALID_REQUEST", error: "Send a valid JSON trade request." }, 400); }
  try { return json(await prepareLaunchPlanTradeV1(input)); }
  catch (error) {
    if (error instanceof LaunchPlanTradeErrorV1) return json({ code: error.code, status: error.status === 503 ? "analysis_pending" : "unavailable", error: error.message }, error.status);
    // Provider URLs, authentication, traces and arbitrary upstream messages stay private.
    return json({ code: "TRADE_ANALYSIS_PENDING", status: "analysis_pending", error: "The exact trade is temporarily unavailable. Refresh its current quote." }, 503);
  }
}
