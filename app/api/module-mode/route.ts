import { NextResponse } from "next/server";
import { readModuleModeAvailability } from "@/lib/server/module-mode/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Read-only: release, packages and publication origins come exclusively from reviewed server configuration. */
export async function GET(): Promise<NextResponse> {
  const availability = await readModuleModeAvailability();
  return NextResponse.json(availability, {
    status: availability.release || availability.catalog.length ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
