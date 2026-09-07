import { PROGRAMMABLE_AGENT_ENTRY } from "@/lib/agent-connection";

export const dynamic = "force-static";

export function GET() {
  return Response.json(PROGRAMMABLE_AGENT_ENTRY, { headers: {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "X-Content-Type-Options": "nosniff",
  } });
}
