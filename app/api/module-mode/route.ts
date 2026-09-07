import { NextResponse } from "next/server";
import { readModuleModeAvailability } from "@/lib/server/module-mode/catalog";
import { readModuleEngineAvailability } from "@/lib/server/module-engine/catalog";
import { parseModuleModeReleaseSelection } from "@/lib/module-mode/release-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Read-only: release, packages and publication origins come exclusively from reviewed server configuration. */
export async function GET(request: Request): Promise<NextResponse> {
  const query = new URL(request.url).searchParams;
  let selection;
  try { selection = parseModuleModeReleaseSelection(query); }
  catch {
    return NextResponse.json({ error: "invalid_release_digest" }, { status: 400,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  if (selection.sourceKind === "module-engine-v1") {
    const availability = await readModuleEngineAvailability(selection.releaseDigest);
    return NextResponse.json(availability, { status: availability.release ? 200 : 503,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const availability = await readModuleModeAvailability(selection.releaseDigest);
  return NextResponse.json(availability, {
    status: availability.release || availability.catalog.length ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
