import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { LaunchClaimV1 } from "@/lib/custom-launch/launch-plan-v1";
import { parseLaunchProjectionV1 } from "@/lib/custom-launch/launch-projection-v1";
import { launchProjectionSourceV1 } from "@/lib/server/robinhood-index/launch-projection-source";
import { component, nowIso, projectionFixture, runtimeHash } from "./fixtures/universal-launch-v1";

const maximumBytes = 16_777_216;
function claim(index: number): LaunchClaimV1 {
  return { claimType: "programmable.runtime.opcode", subject: `${component}:${index}`, observedValue: { opcode: "SLOAD", programCounter: index },
    status: "verified", witness: { kind: "runtime", ref: `fixture:runtime:${index}`, details: { address: component, runtimeCodeHash: runtimeHash } },
    assessor: "runtime-verifier", assessorVersion: "fixture-v1", validAt: nowIso, blockNumber: "42" };
}
function source(response: Response) {
  vi.stubEnv("ROBINHOOD_RPC_URL", "https://primary.example");
  vi.stubEnv("ROBINHOOD_RPC_SECONDARY_URL", "https://secondary.example");
  vi.stubGlobal("fetch", vi.fn(async () => response));
  return launchProjectionSourceV1().page(null);
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("complete launch projection response bounds", () => {
  it("retains more than 1024 source-bound assurance claims without truncation", async () => {
    const projection = { ...projectionFixture(), assuranceClaims: Array.from({ length: 1200 }, (_, index) => claim(index)) };
    expect(parseLaunchProjectionV1(projection).assuranceClaims).toEqual(projection.assuranceClaims);
    const page = await source(Response.json({ schemaVersion: "programmable.launch-projection-page.v1", launches: [projection], nextCursor: null }));
    expect(page.launches[0].assuranceClaims).toEqual(projection.assuranceClaims);
    expect(page.launches[0].assuranceClaims.at(-1)?.subject).toBe(`${component}:1199`);
  });
  it("uses the complete published 16 MiB budget rather than the previous 4 MiB limit", async () => {
    const projection = { ...projectionFixture(), assuranceClaims: [{ ...claim(0), observedValue: "x".repeat(4_194_304) }] };
    const text = JSON.stringify({ schemaVersion: "programmable.launch-projection-page.v1", launches: [projection], nextCursor: null });
    expect(Buffer.byteLength(text)).toBeGreaterThan(4_194_304);
    expect(Buffer.byteLength(text)).toBeLessThan(maximumBytes);
    const page = await source(new Response(text, { headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) } }));
    expect(page.launches[0].assuranceClaims[0].observedValue).toBe(projection.assuranceClaims[0].observedValue);
  });
  it("rejects an oversized advertised response before reading it", async () => {
    await expect(source(new Response("{}", { headers: { "content-type": "application/json", "content-length": String(maximumBytes + 1) } }))).rejects.toThrow(/unavailable/);
  });
  it("still bounds the actual response bytes when Content-Length is absent", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maximumBytes + 1)); },
      cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
    await expect(source(response)).rejects.toThrow(/byte budget/);
    expect(cancelled).toBe(true);
  });
});
