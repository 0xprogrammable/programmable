import { describe, expect, it } from "vitest";

import { GET } from "@/app/analytics/route";

describe("analytics short link", () => {
  it("redirects to the canonical public Dune dashboard", () => {
    const response = GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://dune.com/programmablehq/analytics",
    );
  });
});
