import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readPreservedBackendPublicErrorV1,
} from "../lib/server/custom-launch/backend-public-error-v1";

const REQUEST_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";

function backendError(
  status: number,
  code: string,
  options: Readonly<{
    retryAfter?: string;
    details?: Readonly<Record<string, unknown>>;
  }> = {},
) {
  return new Response(JSON.stringify({
    schemaVersion: "programmable.api-error.v1",
    error: {
      code,
      message: "The request could not be completed.",
      requestId: REQUEST_ID,
      ...(options.details ? { details: options.details } : {}),
    },
  }), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": REQUEST_ID,
      ...(options.retryAfter ? { "retry-after": options.retryAfter } : {}),
    },
  });
}

describe("preserved Custom Launch backend public errors", () => {
  it("preserves unavailable API-key capability with retry guidance and no internal details", async () => {
    const error = await readPreservedBackendPublicErrorV1(backendError(503, "API_KEY_CAPABILITY_UNAVAILABLE", {
      retryAfter: "17", details: { internalCatalog: "must-not-cross" },
    }));
    expect(error).toMatchObject({ status: 503, code: "API_KEY_CAPABILITY_UNAVAILABLE", retryAfter: "17" });
    expect(JSON.stringify(error)).not.toContain("must-not-cross");
  });

  it("preserves only the public partner-admin 403 contract", async () => {
    const error = await readPreservedBackendPublicErrorV1(
      backendError(403, "PARTNER_ADMIN_FORBIDDEN", {
        details: {
          internalRule: "must-not-cross",
          rootKeySecret: `pm_partner_root_${"A".repeat(22)}_${"B".repeat(43)}`,
        },
      }),
    );

    expect(error).toMatchObject({
      status: 403,
      code: "PARTNER_ADMIN_FORBIDDEN",
      publicMessage: "The request could not be completed.",
      requestId: REQUEST_ID,
      retryAfter: null,
    });
    expect(JSON.stringify(error)).not.toContain("must-not-cross");
    expect(JSON.stringify(error)).not.toContain("pm_partner_root_");
    await expect(readPreservedBackendPublicErrorV1(
      backendError(403, "INTERNAL_FORBIDDEN"),
    )).resolves.toBeNull();
  });

  it("preserves only the safe launch-not-found 404 contract", async () => {
    const error = await readPreservedBackendPublicErrorV1(
      backendError(404, "LAUNCH_NOT_FOUND", {
        details: { lookup: "must-not-cross" },
      }),
    );

    expect(error).toMatchObject({
      status: 404,
      code: "LAUNCH_NOT_FOUND",
      publicMessage: "The request could not be completed.",
      requestId: REQUEST_ID,
      retryAfter: null,
    });
    expect(JSON.stringify(error)).not.toContain("must-not-cross");
    await expect(readPreservedBackendPublicErrorV1(
      backendError(404, "INTERNAL_NOT_FOUND"),
    )).resolves.toBeNull();
  });

  it.each([
    "FUNDING_SIGNATURE_OWNER_MISMATCH",
    "SIMULATION_REVERTED",
  ])("preserves safe 422 %s responses", async (code) => {
    const error = await readPreservedBackendPublicErrorV1(
      backendError(422, code, {
        details: {
          internalTrace: "must-not-cross",
          apiKey: `pm_live_${"A".repeat(22)}_${"B".repeat(43)}`,
        },
      }),
    );

    expect(error).toMatchObject({
      status: 422,
      code,
      publicMessage: "The request could not be completed.",
      requestId: REQUEST_ID,
      retryAfter: null,
    });
    expect(error).not.toHaveProperty("details");
    expect(JSON.stringify(error)).not.toContain("pm_live_");
    expect(JSON.stringify(error)).not.toContain("must-not-cross");
  });

  it.each([
    "SIMULATION_UNAVAILABLE",
    "LAUNCH_UNAVAILABLE",
    "CUSTOM_LAUNCH_V3_UNAVAILABLE",
    "WALLET_ADMIN_UNAVAILABLE",
    "CLASSIC_LAUNCH_AUTHORIZATION_UNAVAILABLE",
  ])("preserves safe 503 %s responses and retry metadata", async (code) => {
    const error = await readPreservedBackendPublicErrorV1(
      backendError(503, code, { retryAfter: "17" }),
    );

    expect(error).toMatchObject({
      status: 503,
      code,
      publicMessage: "The request could not be completed.",
      requestId: REQUEST_ID,
      retryAfter: "17",
    });
  });

  it.each([
    [404, "PROFILE_NOT_FOUND"],
    [403, "INSUFFICIENT_SCOPE"],
    [422, "PROFILE_INVALID"],
    [422, "INTERNAL_SECRET"],
    [503, "INTERNAL_ERROR"],
    [503, "FUNDING_SIGNATURE_OWNER_MISMATCH"],
  ])("rejects an unapproved HTTP %i/code pairing", async (status, code) => {
    await expect(
      readPreservedBackendPublicErrorV1(backendError(status, code)),
    ).resolves.toBeNull();
  });
});
