import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseReviewArtifact, parseReviewAttempt, parseReviewJob, parseReviewPlan, parseReviewProgramAbi, parseReviewQueueItem, reviewDigest } from "../lib/module-mode/review-contract";
import { createPublicationSessionExporter, type PublicationSession } from "../lib/module-mode/publication-session";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import { readOperatorSession } from "../ops/module-mode-publication/review";
import { ModuleReviewAdminConsole } from "../components/module-review-admin-console";
import { moduleReviewAdminFixture } from "./fixtures/module-review-admin";

const walletFixture = vi.hoisted(() => ({ authenticated: false, authReady: true, sessionReady: true, disconnecting: false,
  connecting: false, wallet: { account: "0x79879fe6f00c0986Ca521eA6F5b276b5E28b1b9C" },
  getAccessToken: vi.fn(async () => "synthetic_access_token_no_authority"),
  getIdentityToken: vi.fn(async () => "synthetic_identity_token_no_authority"), openWallet: vi.fn() }));
vi.mock("../components/wallet-provider", () => ({ useWallet: () => walletFixture }));

function redigest<T extends { artifactDigest: string }>(value: T) { const { artifactDigest: _old, ...body } = value; void _old; return { ...body, artifactDigest: reviewDigest("programmable.modules.native-build.v1", body) }; }
describe("Private module review wire boundaries", () => {
  it("accepts a bound full build and separately a lightweight queue entry", () => {
    const f = moduleReviewAdminFixture(); expect(parseReviewJob(f.job)).toEqual(f.job);
    expect(parseReviewQueueItem({ ...f.job, plan: null, artifact: null })).toMatchObject({ state: "built", build: null, updatedAt: f.job.updatedAt });
    expect(() => parseReviewJob({ ...f.job, plan: null, artifact: null })).toThrow();
  });
  it("requires an artifact for built and accepted detail states", () => {
    const f = moduleReviewAdminFixture(); expect(() => parseReviewJob({ ...f.job, artifact: null })).toThrow("required build");
  });
  it("rejects an artifact attached to a different submission", () => {
    const f = moduleReviewAdminFixture(); expect(() => parseReviewArtifact(f.artifact, { ...f.subject, submissionId: "00000000-0000-4000-8000-000000000003" })).toThrow("subject");
  });
  it("checks actual bytecode and ABI hashes even when the artifact is redigested", () => {
    const f = moduleReviewAdminFixture();
    expect(() => parseReviewArtifact(redigest({ ...f.artifact, program: { ...f.artifact.program, runtimeBytecode: "0x00" } }), f.subject)).toThrow("bytecode");
    expect(() => parseReviewArtifact(redigest({ ...f.artifact, program: { ...f.artifact.program, abi: [{ type: "fallback" }] } }), f.subject)).toThrow("ABI");
  });
  it("does not present missing checks as passing tests", () => {
    const f = moduleReviewAdminFixture(); const changed = structuredClone(f.artifact); changed.tests.cases[0].budgetIsolationChecked = null;
    expect(() => parseReviewArtifact(redigest(changed), f.subject)).toThrow("reported test success");
  });
  it("requires an explicit configuration codec and ABI plan without a legacy fallback", () => {
    const f = moduleReviewAdminFixture();
    const { programAbi, configurationCodec, ...legacy } = f.plan;
    expect(() => parseReviewPlan(legacy, f.subject)).toThrow();
    expect(() => parseReviewPlan({ ...legacy, programAbi }, f.subject)).toThrow();
    expect(() => parseReviewPlan({ ...legacy, configurationCodec }, f.subject)).toThrow();
    expect(() => parseReviewPlan({ ...f.plan, configurationCodec: "open-config" }, f.subject)).toThrow("codec");
    expect(parseReviewProgramAbi([])).toEqual([]);
  });
  it.each([
    [{ path: ["constructor"], type: "address" }], [{ path: ["__proto__"], type: "uint256" }],
    [{ path: ["prototype"], type: "bool" }], [{ path: ["not.a.path"], type: "string" }],
    [{ path: ["00"], type: "bytes" }], [{ path: Array(17).fill("a"), type: "uint8" }],
    [{ path: [], type: "uint7" }], [{ path: [], type: "uint264" }], [{ path: [], type: "bytes33" }],
    [{ path: [], type: "tuple" }], [{ path: [], type: "address[0]" }], [{ path: [], type: "uint32[257]" }],
    [{ path: [], type: `bool${"[]".repeat(13)}` }], [{ path: [], type: "uint8", components: [] }],
    Array.from({ length: 129 }, () => ({ path: [], type: "uint256" })),
  ].map(mapping => ({ mapping })))("rejects an invalid native ABI mapping %#", ({ mapping }) => {
    expect(() => parseReviewProgramAbi(mapping)).toThrow();
  });
  it("preserves ABI argument order and accepts bounded native scalar and array types", () => {
    const mapping = [{ path: ["nested", "0", "account"], type: "address" }, { path: [], type: "uint" }, { path: ["values"], type: "uint128[][256]" }, { path: ["blob"], type: "bytes32" }];
    expect(parseReviewProgramAbi(mapping)).toEqual(mapping);
    const f = moduleReviewAdminFixture();
    const changed = redigest({ ...f.artifact, programAbi: [...f.plan.programAbi].reverse() });
    expect(() => parseReviewJob({ ...f.job, artifact: changed })).toThrow("configuration ABI binding");
  });
  it.each([
    { callbackGas: 500001 }, { factoryComponentId: "program" }, { shell: "compile arbitrary source" },
    { cases: [{ id: "negative", parameters: {}, budgetWei: "0", expectedDeployment: "revert" }] },
    { cases: [{ id: "positive", parameters: {}, budgetWei: "0", expectedDeployment: "success", rawConfigBytes: "0x00" }] },
  ])("rejects invalid operator plan %j", change => { const f = moduleReviewAdminFixture(); expect(() => parseReviewPlan({ ...f.plan, ...change }, f.subject)).toThrow(); });
  it("binds worker attempt history and never accepts a lease or secret field", () => {
    const f = moduleReviewAdminFixture(); expect(parseReviewAttempt(f.detail.attempts[0], f.subject)).toEqual(f.detail.attempts[0]);
    expect(() => parseReviewAttempt({ ...f.detail.attempts[0], leaseToken: "private" }, f.subject)).toThrow();
    expect(() => parseReviewAttempt({ ...f.detail.attempts[0], workerIdentity: { ...f.detail.attempts[0].workerIdentity, runId: "javascript:bad" } }, f.subject)).toThrow();
  });
});

describe("Explicit private publication session download", () => {
  const access = "synthetic_access_token_no_authority";
  const identity = "synthetic_identity_token_no_authority";
  function fixture() {
    let session: PublicationSession | null = Object.freeze({ walletAddress: WEBSITE_ADMIN_WALLET });
    const input = { readSession: () => session, getAccessToken: vi.fn<() => Promise<string | null>>(async () => access),
      getIdentityToken: vi.fn<() => Promise<string | null>>(async () => identity), download: vi.fn<(json: string) => void>() };
    return { input, changeSession: (next: PublicationSession | null) => { session = next; } };
  }

  it.each([true, false])("round-trips the closed original owner-only file (identity token: %s)", async includeIdentity => {
    const f = fixture(); if (!includeIdentity) f.input.getIdentityToken.mockResolvedValue(null);
    expect(await createPublicationSessionExporter()(f.input)).toBe("downloaded");
    expect(f.input.download).toHaveBeenCalledTimes(1);
    const text = f.input.download.mock.calls[0][0];
    const expected = { walletAddress: WEBSITE_ADMIN_WALLET.toLowerCase(), accessToken: access,
      ...(includeIdentity ? { identityToken: identity } : {}) };
    expect(JSON.parse(text)).toEqual(expected);
    const directory = await mkdtemp(path.join(tmpdir(), "module-session-synthetic-"));
    try {
      const file = path.join(directory, "session.json"); await writeFile(file, text, { mode: 0o600, flag: "wx" });
      expect(await readOperatorSession(file)).toEqual(expected);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["identity", "access"])("cancels a new session of the same account during the %s await", async stage => {
    const f = fixture();
    const change = () => f.changeSession(Object.freeze({ walletAddress: WEBSITE_ADMIN_WALLET }));
    if (stage === "identity") f.input.getIdentityToken.mockImplementation(async () => { change(); return identity; });
    else f.input.getAccessToken.mockImplementation(async () => { change(); return access; });
    expect(await createPublicationSessionExporter()(f.input)).toBe("session-changed");
    expect(f.input.download).not.toHaveBeenCalled();
    if (stage === "identity") expect(f.input.getAccessToken).not.toHaveBeenCalled();
  });

  it.each([null, { walletAddress: "0x1111111111111111111111111111111111111111" }])("does not retrieve tokens without the current admin session: %j", async session => {
    const f = fixture(); f.changeSession(session);
    expect(await createPublicationSessionExporter()(f.input)).toBe("session-changed");
    expect(f.input.getIdentityToken).not.toHaveBeenCalled(); expect(f.input.getAccessToken).not.toHaveBeenCalled();
    expect(f.input.download).not.toHaveBeenCalled();
  });

  it("locks synchronously before token retrieval and releases after completion", async () => {
    const f = fixture(), run = createPublicationSessionExporter();
    let release!: (value: string) => void;
    f.input.getIdentityToken.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const first = run(f.input), second = run(f.input);
    expect(await second).toBe("busy"); expect(f.input.getIdentityToken).toHaveBeenCalledTimes(1);
    release(identity); expect(await first).toBe("downloaded"); expect(f.input.download).toHaveBeenCalledTimes(1);
    expect(await run(f.input)).toBe("downloaded"); expect(f.input.download).toHaveBeenCalledTimes(2);
  });

  it("rejects missing, malformed or oversized tokens and never returns SDK error details", async () => {
    const run = createPublicationSessionExporter();
    for (const token of [null, "short", `${access}\n${identity}`]) {
      const f = fixture(); f.input.getAccessToken.mockResolvedValue(token);
      expect(await run(f.input)).toBe("unavailable"); expect(f.input.download).not.toHaveBeenCalled();
    }
    const f = fixture(); f.input.getAccessToken.mockResolvedValue("a".repeat(16_384)); f.input.getIdentityToken.mockResolvedValue("b".repeat(16_384));
    expect(await run(f.input)).toBe("unavailable"); expect(f.input.download).not.toHaveBeenCalled();
    f.input.getAccessToken.mockRejectedValue(new Error(`${access} ${identity}`));
    expect(await run(f.input)).toBe("unavailable"); expect(f.input.download).not.toHaveBeenCalled();
  });

  it("renders the action only for the authenticated admin and never renders token content", () => {
    try {
      walletFixture.authenticated = false;
      expect(renderToStaticMarkup(createElement(ModuleReviewAdminConsole))).not.toContain("Download publication session");
      walletFixture.authenticated = true;
      walletFixture.wallet.account = "0x1111111111111111111111111111111111111111";
      expect(renderToStaticMarkup(createElement(ModuleReviewAdminConsole))).not.toContain("Download publication session");
      walletFixture.wallet.account = WEBSITE_ADMIN_WALLET;
      const html = renderToStaticMarkup(createElement(ModuleReviewAdminConsole));
      expect(html).toContain("Download publication session"); expect(html).toContain("Contains your login tokens.");
      expect(html).toContain('role="status"'); expect(html).not.toContain(access); expect(html).not.toContain(identity);
      expect(walletFixture.getAccessToken).not.toHaveBeenCalled(); expect(walletFixture.getIdentityToken).not.toHaveBeenCalled();
    } finally { walletFixture.authenticated = false; walletFixture.wallet.account = WEBSITE_ADMIN_WALLET; }
  });
});
