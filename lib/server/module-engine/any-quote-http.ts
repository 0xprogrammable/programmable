import "server-only";
import { NextResponse } from "next/server";
import { AnyQuoteErrorV1 } from "@/lib/module-engine/any-quote/types";
import { readBoundedUtf8BodyV1, BoundedBodyErrorV1 } from "../custom-launch/bounded-utf8-body-v1";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
/** Bounded read-only BFF. It never accepts provider endpoints, credentials, approval authority or arbitrary calldata. */
export async function anyQuoteJsonRequest<T>(request: Request, read: (input: T) => Promise<unknown>): Promise<NextResponse> {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 415, headers });
    const source = await readBoundedUtf8BodyV1(request, 32_768, { signal: request.signal, timeoutMs: 5_000 });
    let input: T;
    try { input = JSON.parse(source); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(); }
    catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers }); }
    return NextResponse.json(await read(input), { headers });
  } catch (error) {
    if (error instanceof BoundedBodyErrorV1) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: error.code === "too-large" ? 413 : 400, headers });
    const known = error instanceof AnyQuoteErrorV1 ? error : new AnyQuoteErrorV1("PROVIDER_OR_EXECUTION_INCONCLUSIVE");
    const invalid = known.code.startsWith("INVALID_");
    return NextResponse.json({ status: known.status, chainId: 4663, quoteAsset: null, code: known.code, retryable: known.status === "inconclusive",
      message: known.status === "incompatible" ? "Der Token ist leider nicht verfügbar." : "Die Prüfung ist gerade nicht möglich. Bitte erneut versuchen." }, { status: invalid ? 400 : known.status === "incompatible" ? 422 : 503, headers });
  }
}
