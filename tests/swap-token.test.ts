import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { resolveSwapToken, type SwapTokenDependencies } from "@/lib/server/swap/token";
import { normalizeSupportedModuleModeLaunches } from "@/lib/module-mode/source-adapters";
import { moduleEnginePublicLaunch, moduleModePublicLaunch } from "@/lib/server/robinhood-index/module-source";
import { bindActiveModuleModeRelease } from "@/lib/module-mode/release";
import { bindActiveModuleEngineRelease, type ModuleEngineAvailability, type ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import type { ModuleEngineProvenanceV1 } from "@/lib/module-engine/index/provenance-v1";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";
import { moduleEvidenceFixtureV2 } from "./fixtures/module-mode-evidence-v2";
import anyQuote from "./fixtures/module-engine-any-quote-index.json";
import anyQuoteEth from "./fixtures/module-engine-any-quote-eth-index.json";
import genericEngine from "./fixtures/module-engine-index.json";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodToken: vi.fn() }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumToken: vi.fn() }));
vi.mock("@/lib/server/swap/custom-v4", () => ({ readCustomV4SwapDescriptor: vi.fn() }));

// Synthetic source fixtures exercise routing decisions only, never live execution.
function dependencies(row: RobinhoodLaunch) {
  return {
    robinhood: vi.fn(async () => ({ token: row, status: "ready" })), ethereum: vi.fn(),
    native: vi.fn(), engine: vi.fn(), custom: vi.fn(async () => ({ launch: row })),
  } as unknown as SwapTokenDependencies;
}
function nativeFixture(v2 = false) {
  const fixture = v2 ? moduleEvidenceFixtureV2(0, 0) : moduleEvidenceFixture(0, 0);
  const row = moduleModePublicLaunch(normalizeSupportedModuleModeLaunches([fixture.evidence], fixture.release)[0], null);
  const deps = dependencies(row), release = bindActiveModuleModeRelease(fixture.release);
  vi.mocked(deps.native).mockResolvedValue({ schemaVersion: "programmable.module-mode.availability.v1", release, catalog: [], reason: null });
  return { row, deps, release };
}

describe("swap source resolution", () => {
  it.each([false, true])("uses the exact saved native release with an empty current catalogue (V2=%s)", async v2 => {
    const f = nativeFixture(v2);
    const value = await resolveSwapToken({ address: f.row.tokenAddress }, f.deps);
    expect(value).toMatchObject({ status: "ready", chainId: 4663, token: { address: getAddress(f.row.tokenAddress), decimals: 18 }, route: { kind: "module-native", availability: { release: f.release } } });
    expect(f.deps.native).toHaveBeenCalledWith(f.row.sourceReleaseDigest);
    expect(f.deps.custom).not.toHaveBeenCalled();
  });

  it("does not substitute the current release for an unavailable historical release", async () => {
    const f = nativeFixture();
    vi.mocked(f.deps.native).mockResolvedValue({ schemaVersion: "programmable.module-mode.availability.v1", release: null, catalog: [], reason: "Unavailable" });
    expect(await resolveSwapToken({ address: f.row.tokenAddress }, f.deps)).toMatchObject({ status: "unavailable", route: null });
    vi.mocked(f.deps.native).mockResolvedValue({ schemaVersion: "programmable.module-mode.availability.v1", release: { ...f.release, releaseDigest: h(999) }, catalog: [], reason: null });
    expect(await resolveSwapToken({ address: f.row.tokenAddress }, f.deps)).toMatchObject({ status: "unavailable", route: null });
  });

  it.each([anyQuote, anyQuoteEth])("resolves both shared Any Quote generations from their original engine source", async fixture => {
    const item = fixture.cases[0], row = moduleEnginePublicLaunch(item.normalized as unknown as ModuleEngineProvenanceV1, null), deps = dependencies(row);
    const template = { manifest: { manifest: { revision: { packageId: row.engineRevisionId }, catalogDefinition: { interface: "quote-shared-v1" } } } } as ModuleEngineTemplate;
    const availability = { release: bindActiveModuleEngineRelease(item.release), templates: [template] } as ModuleEngineAvailability;
    vi.mocked(deps.engine).mockResolvedValue(availability);
    expect(await resolveSwapToken({ address: row.tokenAddress }, deps)).toMatchObject({ status: "ready", route: { kind: "any-quote", availability, template } });
    expect(deps.engine).toHaveBeenCalledWith(row.sourceReleaseDigest);
  });

  it("does not invent an ETH route for an engine with no market", async () => {
    const item = genericEngine.cases[0], row = moduleEnginePublicLaunch(item.normalized as unknown as ModuleEngineProvenanceV1, null), deps = dependencies(row);
    vi.mocked(deps.engine).mockResolvedValue({ release: bindActiveModuleEngineRelease(item.release), templates: [{ manifest: { manifest: { revision: { packageId: row.engineRevisionId }, catalogDefinition: { interface: "quote-v1" } } } }] } as ModuleEngineAvailability);
    expect(await resolveSwapToken({ address: row.tokenAddress }, deps)).toMatchObject({ status: "unavailable", route: null, manageHref: expect.stringContaining("/launch/modules/manage/"), reason: expect.stringContaining("no trading pool") });
    expect(deps.custom).not.toHaveBeenCalled();
  });

  it("rejects supporting-contract lookup instead of swapping the primary asset", async () => {
    const f = nativeFixture();
    await expect(resolveSwapToken({ address: a(999) }, f.deps)).rejects.toMatchObject({ code: "NOT_PRIMARY_TOKEN" });
    expect(f.deps.native).not.toHaveBeenCalled();
  });

  it.each([undefined, "multi-role-v2"] as const)("delegates historical custom source %s without manufacturing a vNext projection", async sourceKind => {
    const row = { ...nativeFixture().row, sourceKind } as RobinhoodLaunch, deps = dependencies(row);
    expect(await resolveSwapToken({ address: row.tokenAddress }, deps)).toMatchObject({ status: "ready", route: { kind: "custom-v4", descriptor: { launch: row } } });
    expect(deps.custom).toHaveBeenCalledWith(row);
  });

  it("leaves unrecognized assets unavailable instead of falling back to arbitrary swaps", async () => {
    const f = nativeFixture();
    vi.mocked(f.deps.robinhood).mockResolvedValue({ token: null, status: "ready" } as Awaited<ReturnType<SwapTokenDependencies["robinhood"]>>);
    await expect(resolveSwapToken({ address: a(900) }, f.deps)).rejects.toMatchObject({ code: "TOKEN_NOT_FOUND" });
    expect(f.deps.custom).not.toHaveBeenCalled();
  });

  it("reuses the existing Ethereum classic adapter with token decimals", async () => {
    const f = nativeFixture();
    vi.mocked(f.deps.ethereum).mockResolvedValue({ status: "ready", token: { tokenAddress: a(300), name: "Decimal fixture", symbol: "DEC", tokenDecimals: 6, hookAddress: a(301), poolId: h(300), launchModel: "classic" } } as Awaited<ReturnType<SwapTokenDependencies["ethereum"]>>);
    expect(await resolveSwapToken({ address: a(300), chainId: 1 }, f.deps)).toMatchObject({ status: "ready", chainId: 1, token: { decimals: 6 }, route: { kind: "classic", hook: getAddress(a(301)), poolId: h(300) } });
    expect(f.deps.robinhood).not.toHaveBeenCalled();
  });
});
