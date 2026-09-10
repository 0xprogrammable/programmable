import { moduleReviewRoute } from "@/lib/server/module-mode/review-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return moduleReviewRoute(request, "correction", (await context.params).id);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return moduleReviewRoute(request, "correction-status", (await context.params).id);
}
