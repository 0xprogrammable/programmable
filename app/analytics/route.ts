import { NextResponse } from "next/server";

const DUNE_ANALYTICS_URL =
  "https://dune.com/programmablehq/analytics";

export function GET() {
  return NextResponse.redirect(DUNE_ANALYTICS_URL);
}
