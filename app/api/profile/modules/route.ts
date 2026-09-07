import { isAddress } from "viem";
import { readModuleAuthorProfile } from "@/lib/server/module-mode/author-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Public, accepted module publications only. This route has no access to private applications. */
export async function GET(request: Request) {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { ...headers, Allow: "GET" } });
  const query = new URL(request.url).searchParams;
  const account = query.get("account");
  const page = query.get("page") ?? "1";
  if ([...query.keys()].some(key => !["account", "page"].includes(key) || query.getAll(key).length !== 1)
    || account === null || !isAddress(account, { strict: false }) || !/^[1-9]\d{0,5}$/u.test(page)) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers });
  }
  try {
    const result = await readModuleAuthorProfile(account.toLowerCase(), Number(page));
    return Response.json(result, { status: result.status === "ready" ? 200 : 503, headers });
  } catch {
    return Response.json({ error: "modules_unavailable" }, { status: 503, headers });
  }
}
