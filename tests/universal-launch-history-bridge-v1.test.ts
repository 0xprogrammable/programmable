import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDeveloperLaunchHistoryBridgeV1 } from "@/lib/server/custom-launch/launch-history-bridge-v1";
import { controller, component, hash, recordFixture } from "./fixtures/universal-launch-v1";

function context(body: unknown) {
  const fetchBackend = vi.fn(async () => Response.json(body));
  const bridge = createDeveloperLaunchHistoryBridgeV1({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:controller", privySessionId: "session", wallets: [controller] }) },
    backendBaseUrl: "https://backend.example", websiteToken: "t".repeat(43), bffAssertionKeyV2: "k".repeat(43), fetchBackend,
    assertionNow: () => new Date("2026-09-09T11:00:00.000Z"), assertionNonce: () => Buffer.alloc(16, 7).toString("base64url") });
  return { bridge, fetchBackend };
}
const request = (source = "custom_launch_plan_v1", body?: unknown, wallet = controller) => new Request(
  `https://programmable.market/api/developer/custom-launch-plans?walletAddress=${wallet}&source=${source}`, {
    method: body ? "POST" : "GET", headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
describe("additive controller history bridge", () => {
  it("retains full owner evidence above the old cap and rejects a response beyond the published bound", async () => {
    const record = { ...recordFixture(), admissionEvidence: { proof: "x".repeat(33 * 1024 * 1024) } };
    const { bridge, fetchBackend } = context({ plans: [record], nextCursor: null });
    const response = await bridge.universal(request());
    expect(response.status).toBe(200);
    expect((await response.json()).launches[0].resource.admissionEvidence.proof.length).toBe(33 * 1024 * 1024);
    fetchBackend.mockImplementationOnce(async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(65 * 1024 * 1024 + 1) } }));
    expect((await bridge.universal(request())).status).toBe(503);
  });
  it("preserves plan resource bytes and reuses signed wallet-admin authority", async () => {
    const record = recordFixture();
    const { bridge, fetchBackend } = context({ schemaVersion: "programmable.custom-launch-plan-list.v1", plans: [record], nextCursor: null });
    const response = await bridge.universal(request());
    expect(response.status).toBe(200);
    expect((await response.json()).launches[0].resource).toEqual(record);
    const [url, init] = fetchBackend.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/v4/chains/4663/wallet-admin/custom-launch-plans");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(new Headers(init.headers).get("x-programmable-bff-assertion-version")).toBe("2");
    expect(new Headers(init.headers).get("x-programmable-wallet-address")).toBe(controller);
  });
  it("rejects a different controller and never calls the backend for an unlinked wallet", async () => {
    const record = recordFixture(); const changed = { ...record, plan: { ...record.plan, controller: { ...record.plan.controller, address: component } } };
    const { bridge, fetchBackend } = context(changed);
    expect((await bridge.universal(request(), record.planId)).status).toBe(503);
    fetchBackend.mockClear();
    expect((await bridge.universal(request("custom_launch_plan_v1", undefined, component))).status).toBe(403);
    expect(fetchBackend).not.toHaveBeenCalled();
  });
  it.each([undefined, "v2", "v3"] as const)("signs only the exact transaction tracking body for MultiRole=%s", async (multiRole) => {
    const record = recordFixture(); const body = { schemaVersion: multiRole ? `programmable.multi-role-transaction-hint.${multiRole}` : "programmable.custom-launch-plan-step-proof.v1", transactionHash: hash };
    const { bridge, fetchBackend } = context({ ...body, authoritative: false, accepted: true });
    expect((await bridge.universal(request(multiRole ? "multi_role_v2" : "custom_launch_plan_v1", body), record.planId, multiRole ? undefined : "configure", multiRole)).status).toBe(200);
    const [url, init] = fetchBackend.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe(`/v4/chains/4663/wallet-admin/${multiRole ? "custom-launches-multi-role" : "custom-launch-plans"}/${record.planId}${multiRole === "v3" ? "/transaction-hints-v3" : multiRole ? "/transaction-hints" : "/steps/configure/proofs"}`);
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe(JSON.stringify(body));
    expect(new Headers(init.headers).get("x-programmable-bff-assertion-body-sha256")).toBe(`sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`);
    fetchBackend.mockClear();
    expect((await bridge.universal(request(multiRole ? "multi_role_v2" : "custom_launch_plan_v1", { ...body, target: component }), record.planId, multiRole ? undefined : "configure", multiRole)).status).toBe(400);
    expect(fetchBackend).not.toHaveBeenCalled();
  });
  it.each(["v2", "v3"] as const)("rejects a hint body from a different original contract on the %s route", async (version) => {
    const { bridge, fetchBackend } = context({ accepted: true });
    const body = { schemaVersion: `programmable.multi-role-transaction-hint.${version === "v2" ? "v3" : "v2"}`, transactionHash: hash };
    expect((await bridge.universal(request("multi_role_v2", body), recordFixture().planId, undefined, version)).status).toBe(400);
    expect(fetchBackend).not.toHaveBeenCalled();
    expect((await bridge.universal(request("multi_role_v2", { ...body, schemaVersion: `programmable.multi-role-transaction-hint.${version}` }, component), recordFixture().planId, undefined, version)).status).toBe(403);
    expect(fetchBackend).not.toHaveBeenCalled();
  });
});
