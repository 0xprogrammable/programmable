import { moduleModeIndexerContract } from "@/lib/module-mode/indexer-contract";

export const dynamic = "force-static";

export function GET() {
  return Response.json(moduleModeIndexerContract, { headers: {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "X-Content-Type-Options": "nosniff",
  } });
}
