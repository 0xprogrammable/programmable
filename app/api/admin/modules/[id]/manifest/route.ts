import { moduleReviewRoute } from "@/lib/server/module-mode/review-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return moduleReviewRoute(request, "manifest", (await context.params).id);
}
