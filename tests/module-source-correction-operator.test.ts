import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../ops/module-mode-publication/main";
import { runSourceCorrection } from "../ops/module-mode-publication/correction";
import { moduleSourceCorrectionFixture } from "./fixtures/module-source-correction";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup(mode: "success" | "lost-committed" | "lost-uncommitted" = "success") {
  const f = moduleSourceCorrectionFixture();
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), "module-correction-test-")); directories.push(directory);
  const sessionFile = path.join(directory, "session.json"), commandFile = path.join(directory, "command.json"), output = path.join(directory, "result");
  const token = "synthetic_private_operator_session_20260910";
  await writeFile(sessionFile, JSON.stringify({ walletAddress: f.reviewer, accessToken: token }), { mode: 0o600 });
  await writeFile(commandFile, JSON.stringify(f.command), { mode: 0o600 });
  const state = { committed: false };
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://programmable.market"); expect(url.pathname).toMatch(/^\/api\/admin\/modules\/[0-9a-f-]+(?:\/(?:source|corrections))?$/u);
    expect(init).toMatchObject({ cache: "no-store", redirect: "error" }); expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    if (url.pathname.endsWith("/corrections")) {
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ walletAddress: f.reviewer, command: f.command });
        state.committed = mode !== "lost-uncommitted";
        if (mode !== "success") throw new Error("Synthetic dropped response including credentials must never be logged: " + token);
        return Response.json(f.receipt, { status: 201 });
      }
      return state.committed ? Response.json({ ...f.receipt, created: false }) : Response.json({ error: { code: "MODULE_CORRECTION_NOT_FOUND" } }, { status: 404 });
    }
    if (url.pathname.includes(f.record.submissionId)) return Response.json(url.pathname.endsWith("/source") ? f.corrected : f.correctedWebsiteDetail);
    return Response.json(url.pathname.endsWith("/source") ? f.source : f.websiteDetail);
  });
  const options = { "correction-file": commandFile, "session-file": sessionFile, submission: f.subject.submissionId, output };
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  return { ...f, directory, token, fetchImpl, options, state, log, context: { repositoryRoot: "/synthetic-source-checkout", providers: vi.fn(async () => { throw new Error("Correction must never contact an RPC provider"); }) } };
}
describe("Admin source correction operator", () => {
  it("runs correct-source through the fixed authenticated BFF and verifies preserved attribution and exact new source", async () => {
    const f = await setup(); const original = structuredClone(f.source);
    vi.stubGlobal("fetch", f.fetchImpl);
    const args = ["correct-source", ...Object.entries(f.options).flatMap(([key, value]) => ["--" + key, value])];
    await run(args, f.context);
    expect(f.context.providers).not.toHaveBeenCalled(); expect(f.source).toEqual(original);
    const completion = JSON.parse(await readFile(path.join(f.options.output, "correction.complete.json"), "utf8"));
    expect(completion).toMatchObject({ sourceCorrection: f.record, sourceBytesVerified: true, approved: false, available: false });
    expect(JSON.parse(await readFile(path.join(f.options.output, "corrected-source.json"), "utf8"))).toEqual(f.corrected);
    expect((await stat(path.join(f.options.output, "command.json"))).mode & 0o077).toBe(0);
    expect(f.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(f.token);
  });
  it("reconciles a lost POST response by its persisted receipt without sending a second correction", async () => {
    const f = await setup("lost-committed");
    await runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl);
    expect(f.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    const reads = f.fetchImpl.mock.calls.filter(([input, init]) => String(input).includes("/corrections?") && init?.method === "GET");
    expect(reads).toHaveLength(2);
    expect(JSON.parse(await readFile(path.join(f.options.output, "receipt.json"), "utf8"))).toMatchObject({ created: false, sourceCorrection: f.record });
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(f.token);
  });
  it("keeps an unresolved intent and only reconciles when the same output is resumed", async () => {
    const f = await setup("lost-uncommitted");
    await expect(runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl)).rejects.toThrow("did not return a confirmed result");
    await expect(readFile(path.join(f.options.output, "correction.complete.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl)).rejects.toThrow("No committed correction is visible yet");
    expect(f.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    f.state.committed = true;
    await runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl);
    expect(f.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(f.options.output, "correction.complete.json"), "utf8"))).toMatchObject({ sourceCorrection: f.record });
  });
  it("refuses to replace the command of a pending correction journal", async () => {
    const f = await setup("lost-uncommitted");
    await expect(runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl)).rejects.toThrow();
    await writeFile(f.options["correction-file"], JSON.stringify({ ...f.command, reason: "A different correction cannot borrow the previous command journal." }));
    const before = f.fetchImpl.mock.calls.length;
    await expect(runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl)).rejects.toThrow("Existing correction intent");
    expect(f.fetchImpl.mock.calls).toHaveLength(before);
  });
  it("does not mark a receipt complete when the fetched new source changes the reward wallet", async () => {
    const f = await setup(); f.corrected.descriptor.rewardWallet = f.reviewer;
    await expect(runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl)).rejects.toThrow("Correction source does not bind its original author");
    await expect(readFile(path.join(f.options.output, "correction.complete.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("rejects a stale parent before a network mutation", async () => {
    const f = await setup(); f.websiteDetail.job = { ...f.job, reviewRevision: f.job.reviewRevision + 1 };
    await expect(runSourceCorrection(f.options, f.context.repositoryRoot, f.fetchImpl)).rejects.toThrow("Correction parent revision changed");
    expect(f.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
