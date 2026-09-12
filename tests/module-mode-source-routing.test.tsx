import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleEngineHost } from "@/components/module-engine-host";
import { ModuleLaunchWorkspace } from "@/components/module-launch-workspace";
import { availableAnyQuoteLibraryEntry } from "@/lib/module-mode/launch-workspace";
import { ModuleCoinConsole } from "@/components/module-coin-console";
import { fixture, TOKEN, hash } from "./module-engine-fixture";
import { anyQuoteUiFixture } from "./module-engine-any-quote-ui-fixture";
import reviewedAnyQuoteRelease from "@/config/module-engine/review-release.json";
import { createAnyQuoteConfigurationSchema } from "@/lib/module-engine/any-quote-configuration";
import { isModuleEngineSharedQuoteRelease, isModuleEngineAnyQuoteEthRelease } from "@/lib/module-engine/profile";
import engineEvidence from "./fixtures/module-engine-index.json";
import { normalizeModuleEngineLaunchV1 } from "@/lib/module-engine/index/provenance-v1";
import { bindActiveModuleEngineRelease, bindModuleEngineReleaseIdentity, computeModuleEngineHostManifestHash, moduleEngineReleaseIdentity } from "@/lib/module-engine/catalog";
import { moduleEnginePublicLaunch } from "@/lib/server/robinhood-index/module-source";
const mocks = vi.hoisted(() => ({ native: vi.fn(), engine: vi.fn(), nativeVersions: vi.fn(), engineVersions: vi.fn(), token: vi.fn(), reviewIdentity: null as unknown }));
vi.mock("@/config/module-engine/review-release.json", () => ({ get default() { return mocks.reviewIdentity; } }));
vi.mock("@/components/module-engine-host", () => ({ ModuleEngineHost: () => null }));
vi.mock("@/components/module-mode-launch-host", () => ({ ModuleModeLaunchHost: () => null }));
vi.mock("@/components/module-launch-workspace", () => ({ ModuleLaunchWorkspace: () => null }));
vi.mock("@/components/module-coin-console", () => ({ ModuleCoinConsole: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/server/module-mode/catalog", async original => ({ ...await original<typeof import("@/lib/server/module-mode/catalog")>(), readModuleModeAvailability: mocks.native }));
vi.mock("@/lib/server/module-engine/catalog", () => ({ readModuleEngineAvailability: mocks.engine, readModuleEngineLaunchVersions: mocks.engineVersions }));
vi.mock("@/lib/server/module-mode/launch-profiles", () => ({ readModuleModeLaunchVersions: mocks.nativeVersions }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodToken: mocks.token }));
import { GET } from "@/app/api/module-mode/route";
import Page from "@/app/launch/modules/page";
import ManagePage from "@/app/launch/modules/manage/[address]/page";

const { ANY_QUOTE_ETH_GUARD_RELEASE } = await import(new URL("../contracts/scripts/module-engine/any-quote-eth-basis.mjs", import.meta.url).href);

beforeEach(() => { vi.clearAllMocks(); mocks.reviewIdentity = moduleEngineReleaseIdentity(ANY_QUOTE_ETH_GUARD_RELEASE); mocks.native.mockResolvedValue({ schemaVersion: "programmable.module-mode.availability.v1", release: null, catalog: [], reason: "Unavailable" }); mocks.nativeVersions.mockResolvedValue([]); mocks.engineVersions.mockResolvedValue([]); mocks.engine.mockResolvedValue({ ...fixture().availability, release: null, templates: [] }); mocks.token.mockResolvedValue({ token: null }); });

/** A mocked availability sample for route gating only, not a publication or activation claim. */
function reviewedAnyQuoteAvailability() {
  const f = anyQuoteUiFixture(isModuleEngineAnyQuoteEthRelease(reviewedAnyQuoteRelease)), release = bindActiveModuleEngineRelease({ ...f.release, ...reviewedAnyQuoteRelease });
  if (!isModuleEngineSharedQuoteRelease(release)) throw new Error("Expected the reviewed Any Quote profile");
  const template = structuredClone(f.template);
  template.manifest.manifest.release = moduleEngineReleaseIdentity(release);
  template.manifest.manifest.catalogDefinition.schema = createAnyQuoteConfigurationSchema(release);
  template.manifestHash = computeModuleEngineHostManifestHash(template.manifest);
  return { ...f.availability, release, templates: [template] };
}
describe("source-specific Module Mode product routes", () => {
  it("keeps the installed native ETH review identity separate from public activation", async () => {
    const { default: installed } = await vi.importActual<{ default: unknown }>("@/config/module-engine/review-release.json");
    const identity = bindModuleEngineReleaseIdentity(installed);
    expect(isModuleEngineAnyQuoteEthRelease(identity)).toBe(true);
    expect(() => bindActiveModuleEngineRelease(identity)).toThrow();
    mocks.reviewIdentity = identity;
    // Review identity alone has no public activation or lifecycle evidence.
    mocks.engine.mockResolvedValue({ ...fixture().availability, release: identity, templates: [] });
    const page = await Page({ searchParams: Promise.resolve({}) });
    expect(page.type).toBe(ModuleLaunchWorkspace);
    expect(availableAnyQuoteLibraryEntry(await page.props.requests.anyQuote, page.props.reviewedAnyQuoteDigest)).toBeNull();
    expect(await page.props.requests.versions).toEqual([]);
  });
  it("keeps the current native reader and dispatches only explicit Engine selectors", async () => {
    const f = fixture(); mocks.native.mockResolvedValue({ release: null, catalog: [], reason: "Native disabled" }); mocks.engine.mockResolvedValue(f.availability);
    expect((await GET(new Request("http://localhost/api/module-mode"))).status).toBe(503); expect(mocks.native).toHaveBeenCalledOnce(); expect(mocks.engine).not.toHaveBeenCalled();
    const response = await GET(new Request(`https://programmable.market/api/module-mode?sourceKind=module-engine-v1&releaseDigest=${f.release.releaseDigest}`));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(f.availability); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.engine).toHaveBeenCalledWith(f.release.releaseDigest); expect(mocks.native).toHaveBeenCalledOnce();
    mocks.engine.mockResolvedValue({ ...f.availability, release: null, templates: [] });
    expect((await GET(new Request("https://programmable.market/api/module-mode?sourceKind=module-engine-v1"))).status).toBe(503);
  });
  it.each(["sourceKind=native", "sourceKind=module-engine-v1&sourceKind=module-engine-v1", `sourceKind=module-engine-v1&releaseDigest=${hash(0)}`, "sourceKind=module-engine-v1&sourceUrl=https://example.com"])("rejects invalid selection before any source read: %s", async query => {
    expect((await GET(new Request(`https://programmable.market/api/module-mode?${query}`))).status).toBe(400);
    expect(mocks.native).not.toHaveBeenCalled(); expect(mocks.engine).not.toHaveBeenCalled();
  });
  it("opens the actual matching launch component and isolates an unavailable version reader", async () => {
    const f = fixture(), version = { releaseDigest: f.release.releaseDigest, sourceKind: "module-engine-v1", label: "Fixture template version" };
    mocks.nativeVersions.mockRejectedValue(new Error("Native source unavailable")); mocks.engineVersions.mockResolvedValue([version]);
    const engine = await Page({ searchParams: Promise.resolve({ sourceKind: "module-engine-v1", releaseDigest: f.release.releaseDigest }) });
    expect(engine.type).toBe(ModuleLaunchWorkspace); expect(engine.props.initialSelection).toEqual({ sourceKind: "module-engine-v1", releaseDigest: f.release.releaseDigest });
    expect(await engine.props.requests.versions).toEqual([version]);
    const native = await Page({ searchParams: Promise.resolve({}) }); expect(native.type).toBe(ModuleLaunchWorkspace);
  });
  it.each([false, true])("offers the exact reviewed public Any Quote generation (native ETH fees: %s)", async nativeEthFees => {
    mocks.reviewIdentity = moduleEngineReleaseIdentity(anyQuoteUiFixture(nativeEthFees).release);
    const availability = reviewedAnyQuoteAvailability(); mocks.engine.mockResolvedValue(availability);
    const page = await Page({ searchParams: Promise.resolve({}) });
    expect(page.type).toBe(ModuleLaunchWorkspace);
    const entry = availableAnyQuoteLibraryEntry(await page.props.requests.anyQuote, page.props.reviewedAnyQuoteDigest);
    expect(entry?.releaseDigest).toBe(reviewedAnyQuoteRelease.releaseDigest);
    expect(mocks.engine).toHaveBeenCalledWith(reviewedAnyQuoteRelease.releaseDigest);
    const selected = await Page({ searchParams: Promise.resolve({ sourceKind: "module-engine-v1", releaseDigest: entry?.releaseDigest }) });
    expect(selected.type).toBe(ModuleLaunchWorkspace);
    expect(selected.props.initialSelection.releaseDigest).toBe(reviewedAnyQuoteRelease.releaseDigest);
    expect(selected.props.requests.selectedEngine).toBe(selected.props.requests.anyQuote);
  });
  it.each([false, true])("keeps Any Quote hidden without matching public authority (native ETH fees: %s)", async nativeEthFees => {
    mocks.reviewIdentity = moduleEngineReleaseIdentity(anyQuoteUiFixture(nativeEthFees).release);
    const current = reviewedAnyQuoteAvailability();
    mocks.engineVersions.mockResolvedValue([{ releaseDigest: reviewedAnyQuoteRelease.releaseDigest, sourceKind: "module-engine-v1", label: "Any Quote LP" }]);
    for (const unavailable of [
      { ...current, release: null, templates: [] },
      { ...current, templates: [] },
      { ...current, release: { ...current.release, enabled: false } },
      { ...current, templates: [fixture().template] },
      fixture().availability,
      anyQuoteUiFixture(!nativeEthFees).availability,
    ]) {
      mocks.engine.mockResolvedValue(unavailable);
      const page = await Page({ searchParams: Promise.resolve({}) });
      expect(page.type).toBe(ModuleLaunchWorkspace);
      expect(availableAnyQuoteLibraryEntry(await page.props.requests.anyQuote, page.props.reviewedAnyQuoteDigest)).toBeNull();
    }
    mocks.engine.mockRejectedValue(new Error("Current source unavailable"));
    const unavailablePage = await Page({ searchParams: Promise.resolve({}) });
    expect(availableAnyQuoteLibraryEntry(await unavailablePage.props.requests.anyQuote, unavailablePage.props.reviewedAnyQuoteDigest)).toBeNull();
  });
  it("renders the setup without waiting for availability or historical discovery", async () => {
    const pending = new Promise<never>(() => {});
    mocks.native.mockReturnValue(pending); mocks.engine.mockReturnValue(pending);
    mocks.nativeVersions.mockReturnValue(pending); mocks.engineVersions.mockReturnValue(pending);
    const page = await Page({ searchParams: Promise.resolve({}) });
    expect(page.type).toBe(ModuleLaunchWorkspace);
    expect(page.props.requests.selectedNative).toBe(page.props.requests.native);
    expect(mocks.native).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(mocks.engine).toHaveBeenCalledExactlyOnceWith(reviewedAnyQuoteRelease.releaseDigest);
  }, 500);
  it("dispatches exact management hints and uses the indexed source for a plain coin URL", async () => {
    const hinted = await ManagePage({ params: Promise.resolve({ address: TOKEN }), searchParams: Promise.resolve({ sourceKind: "module-engine-v1", releaseDigest: fixture().release.releaseDigest }) });
    expect(hinted.type).toBe(ModuleEngineHost); expect(hinted.props.token).toBe(TOKEN);
    const f = engineEvidence.cases[0], release = bindActiveModuleEngineRelease(f.release);
    const row = moduleEnginePublicLaunch(normalizeModuleEngineLaunchV1(f.range.launches[0].evidence, release), "2026-09-07T12:00:00.000Z");
    mocks.token.mockResolvedValue({ token: row });
    const canonical = await ManagePage({ params: Promise.resolve({ address: row.tokenAddress }), searchParams: Promise.resolve({}) });
    expect(canonical.type).toBe(ModuleEngineHost); expect(canonical.props).toMatchObject({ token: row.tokenAddress, releaseDigest: release.releaseDigest });
    await expect(ManagePage({ params: Promise.resolve({ address: row.tokenAddress }), searchParams: Promise.resolve({ releaseDigest: hash(99) }) })).rejects.toThrow("NOT_FOUND");
    mocks.token.mockResolvedValue({ token: null });
    expect((await ManagePage({ params: Promise.resolve({ address: TOKEN }), searchParams: Promise.resolve({}) })).type).toBe(ModuleCoinConsole);
  });
});
