import { describe, expect, it } from "vitest";
import { parseReviewArtifact, parseReviewAttempt, parseReviewJob, parseReviewPlan, parseReviewQueueItem, reviewDigest } from "../lib/module-mode/review-contract";
import { moduleReviewAdminFixture } from "./fixtures/module-review-admin";

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
