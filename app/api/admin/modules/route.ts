import { moduleReviewRoute } from "@/lib/server/module-mode/review-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  return moduleReviewRoute(request, "list");
}
