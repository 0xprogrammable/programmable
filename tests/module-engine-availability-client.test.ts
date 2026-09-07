import { afterEach, describe, expect, it, vi } from "vitest";
import { assertModuleEngineOperationAvailability, fetchModuleEngineAvailability } from "@/lib/module-engine/availability-client";
import { computeModuleEngineHostManifestHash } from "@/lib/module-engine/catalog";
import { prepareModuleEngineOperation } from "@/lib/module-engine/client";
import { fixture, ACCOUNT, TOKEN, hash } from "./module-engine-fixture";

afterEach(() => vi.unstubAllGlobals());
describe("current public authority before an engine wallet request", () => {
  it("fetches an exact engine version through the shared endpoint", async () => {
    const f = fixture(), fetcher = vi.fn(async () => Response.json(f.availability)); vi.stubGlobal("fetch", fetcher);
    expect(await fetchModuleEngineAvailability(f.release.releaseDigest)).toEqual(f.availability);
    expect(fetcher).toHaveBeenCalledWith(`/api/module-mode?sourceKind=module-engine-v1&releaseDigest=${f.release.releaseDigest}`,
      expect.objectContaining({ credentials: "same-origin", cache: "no-store", redirect: "error" }));
    await expect(fetchModuleEngineAvailability(hash(99))).rejects.toThrow("requested template version");
  });
  it("displays a disabled source honestly and rejects incompatible responses", async () => {
    const f = fixture(), inactive = { ...f.availability, release: null, templates: [], reason: "Temporarily unavailable." };
    const fetcher = vi.fn(async () => Response.json(inactive, { status: 503 })); vi.stubGlobal("fetch", fetcher);
    expect(await fetchModuleEngineAvailability()).toEqual(inactive);
    fetcher.mockResolvedValue(Response.json(f.availability, { status: 503 })); await expect(fetchModuleEngineAvailability()).rejects.toThrow("could not be verified");
    fetcher.mockResolvedValue(new Response("login", { status: 200 })); await expect(fetchModuleEngineAvailability()).rejects.toThrow("could not be checked");
    fetcher.mockResolvedValue(Response.json({ schemaVersion: "programmable.module-mode.availability.v1", release: null, catalog: [], reason: "Native." }));
    await expect(fetchModuleEngineAvailability()).rejects.toThrow();
  });
  it("rejects removal or replacement after a real private client preparation", async () => {
    const f = fixture(), prepared = await prepareModuleEngineOperation({ ...f, token: TOKEN, account: ACCOUNT });
    if (prepared.kind === "approval-required") throw new Error("Unexpected fixture allowance");
    expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, structuredClone(f.availability))).not.toThrow();
    expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, { ...f.availability, templates: [] })).toThrow("selected template changed");
    const changed = structuredClone(f.availability); changed.templates[0].manifest.manifest.catalogDefinition.summary = "Changed publication";
    changed.templates[0].manifestHash = computeModuleEngineHostManifestHash(changed.templates[0].manifest);
    expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, changed)).toThrow("selected template changed");
    const reviewed = structuredClone(f.availability); reviewed.templates[0].reviewDigest = hash(199);
    expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, reviewed)).toThrow("selected template changed");
    expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, { ...f.availability, release: null, templates: [] })).toThrow("template version changed");
  });
});
