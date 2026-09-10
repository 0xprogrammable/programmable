import { readAnyQuoteTradeQuote } from "@/lib/server/module-engine/any-quote";
import { anyQuoteJsonRequest } from "@/lib/server/module-engine/any-quote-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) { return anyQuoteJsonRequest(request, (input: Parameters<typeof readAnyQuoteTradeQuote>[0]) => readAnyQuoteTradeQuote(input)); }
