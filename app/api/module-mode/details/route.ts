import { NextRequest, NextResponse } from "next/server";
import { readPublicModuleDetails } from "@/lib/server/module-mode/public-details";
import { readPublicModuleEngineDetails } from "@/lib/server/module-engine/public-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams;
  const packages = query.get("packages")?.split(",") ?? [];
  const release = query.get("release");
  const sourceKind = query.get("sourceKind");
  const hash = /^0x(?!0{64}$)[\da-f]{64}$/i;
  if (Array.from(query.keys()).some(key => !["packages", "release", "sourceKind"].includes(key) || query.getAll(key).length !== 1)
    || (sourceKind !== null && sourceKind !== "module-engine-v1")
    || !release || !hash.test(release) || packages.length < 1 || packages.length > 16 || packages.some(value => !hash.test(value))
    || new Set(packages.map(value => value.toLowerCase())).size !== packages.length) {
    return NextResponse.json({ error: "Provide a release and up to 16 distinct module package IDs." }, { status: 400 });
  }
  const details = sourceKind === "module-engine-v1" ? await readPublicModuleEngineDetails(release.toLowerCase()) : await readPublicModuleDetails(release.toLowerCase());
  if (!details) return NextResponse.json({ error: "Module details are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const selected = new Set(packages.map(value => value.toLowerCase()));
  return NextResponse.json({ ...(sourceKind === "module-engine-v1" ? { sourceKind } : {}), releaseDigest: details.releaseDigest,
    items: details.sourceKind === (sourceKind ?? undefined) && details.releaseDigest.toLowerCase() === release.toLowerCase()
      ? details.items.filter(item => item.sourceKind === (sourceKind ?? undefined) && selected.has(item.packageId.toLowerCase())) : [] },
  { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60", "X-Content-Type-Options": "nosniff" } });
}
