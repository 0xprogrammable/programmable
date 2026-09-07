import { NextResponse } from "next/server";
import { readModuleModeAvailability } from "@/lib/server/module-mode/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Read-only: release, packages and publication origins come exclusively from reviewed server configuration. */
export async function GET(request?: Request): Promise<NextResponse> {
  const query = request ? new URL(request.url).searchParams : new URLSearchParams();
  const releaseDigest = query.get("releaseDigest") ?? undefined;
  if ([...query.keys()].some(key => key !== "releaseDigest") || query.getAll("releaseDigest").length > 1
    || (releaseDigest !== undefined && !/^0x(?!0{64}$)[0-9a-f]{64}$/u.test(releaseDigest))) {
    return NextResponse.json({ error: "invalid_release_digest" }, { status: 400,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const availability = await readModuleModeAvailability(releaseDigest);
  return NextResponse.json(availability, {
    status: availability.release || availability.catalog.length ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
