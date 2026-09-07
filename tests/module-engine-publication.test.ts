import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../ops/module-mode-publication/main";
import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import frozen from "./fixtures/module-engine-review-build.json";
import { a, h } from "./fixtures/module-mode-evidence";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import { MODULE_MODE_ECONOMICS_POLICY_V2, MODULE_MODE_FINALITY_POLICY } from "../lib/module-mode/release";
import { MODULE_ENGINE_CONTRACTS, MODULE_ENGINE_SOURCE_ID, computeModuleEngineReleaseDigest, type ModuleEngineReleaseIdentity } from "../lib/module-engine/catalog";
import { ENGINE_REVISION, moduleEngineHostAbi, moduleEngineReadAbi } from "../lib/module-engine/abi";
import { parseReviewJob, parseReviewPlan, reviewDigest, type ReviewJob, type ReviewAttempt } from "../lib/module-mode/review-contract";
import type { ModuleEngineBuildArtifactV1, ModuleEngineBuildPlanV1 } from "../lib/module-mode/review-engine-types";
import { MODULE_ENGINE_CONTEXT_ABI_V1, MODULE_ENGINE_CONSTRUCTOR_ABI_V1 } from "../lib/module-mode/review-engine-types";
import { createAuthenticatedReviewReader, NATIVE_SETTINGS, requireAuthenticatedReview } from "../ops/module-mode-publication/review";
import { createEngineHostPreparation, prepareEnginePublication, type EnginePublicationDefinition, type EnginePublicationPlan } from "../ops/module-mode-publication/core-engine";
import { observeEnginePublicationReadback, readEnginePublicationOwner } from "../ops/module-mode-publication/rpc-engine";
import type { PublicationProvider } from "../ops/module-mode-publication/rpc";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import { validateModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { createModuleReviewClient } from "../lib/server/module-mode/review-client";
import { materializeModuleEngineRuntimeV1, moduleEngineStandardInputV1, verifyModuleEngineBuildArtifactV1 } from "../lib/module-mode/review-engine-contract";
import { createReviewedModuleEngineManifest } from "../lib/module-mode/review-engine-manifest";

vi.mock("server-only", () => ({}));
const reviewer = WEBSITE_ADMIN_WALLET.toLowerCase() as Address;
// Exact backend-owned compiler fixture; worker receipts and authentication here are synthetic test doubles.
// Never submit, review, publish, or sign these fixtures.
const scopedPrefixes = ["openzeppelin/contracts/", "openzeppelin/uniswap-hooks/", "uniswap/blocknumberish/", "uniswap/liquidity-launcher/", "uniswap/uerc20-factory/", "uniswap/v4-core/", "uniswap/v4-periphery/", "solady/src/"];
async function fixture(scopedAliases = false) {
  expect(frozen.evidenceClass).toBe("synthetic-parser-fixture-not-review-or-publication-authority");
  const source = structuredClone(frozen.source);
  if (scopedAliases) {
    // Same eight scoped source paths as the existing source-alias fixture; no compiler is run.
    const content = "// exact source bytes\npragma solidity 0.8.26;\n", sha256 = createHash("sha256").update(content).digest("hex");
    for (const prefix of scopedPrefixes) {
      const path = `dependencies/scoped/${prefix}Probe.sol`;
      source.files.push({ path, sha256, encoding: "base64", bytes: Buffer.from(content).toString("base64") }); source.descriptor.source.files.push({ path, sha256 });
    }
  }
  const checked = validateModuleSubmissionRequest(source);
  if (!checked.ok) throw new Error("Invalid test source");
  const subject = { ...frozen.subject, requestDigest: checked.requestDigest }, plan = { ...structuredClone(frozen.plan), requestDigest: checked.requestDigest } as ModuleEngineBuildPlanV1;
  let artifact = structuredClone(frozen.artifact) as ModuleEngineBuildArtifactV1;
  if (scopedAliases) {
    // Rebind only synthetic fixture identities/instances to its extended source inventory.
    const cases = artifact.cases.map(c => {
      const context = { ...c.context, launchId: reviewDigest("programmable.modules.engine-review-launch.v1", { requestDigest: checked.requestDigest, caseId: c.id }) };
      const constructorArgs = encodeAbiParameters(MODULE_ENGINE_CONSTRUCTOR_ABI_V1, [context, c.configBytes]), runtimeBytecode = materializeModuleEngineRuntimeV1(artifact.engine, constructorArgs);
      return { ...c, context, contextHash: keccak256(encodeAbiParameters([{ type: "tuple", components: MODULE_ENGINE_CONTEXT_ABI_V1 }], [context])), constructorArgs,
        constructorHash: keccak256(constructorArgs), initCodeHash: keccak256(`${artifact.engine.creationBytecode}${constructorArgs.slice(2)}`), runtimeBytecode, runtimeCodeHash: keccak256(runtimeBytecode) };
    });
    const planDigest = reviewDigest("programmable.modules.engine-build-plan.v1", plan), { artifactDigest: _old, ...original } = artifact; void _old;
    const contents = { ...original, subject, packageId: checked.packageId, familyId: checked.familyId, planDigest, cases,
      sourceManifestHash: reviewDigest("programmable.modules.source-manifest.v1", source.descriptor),
      compiler: { ...artifact.compiler, completeInputHash: reviewDigest("programmable.modules.compiler-input.v1", moduleEngineStandardInputV1(source, subject, plan)) },
      tests: { ...artifact.tests, requestDigest: checked.requestDigest, planDigest, cases: artifact.tests.cases.map((c, i) => ({ ...c, constructorHash: cases[i].constructorHash, runtimeCodeHash: cases[i].runtimeCodeHash })) } };
    artifact = { ...contents, artifactDigest: reviewDigest("programmable.modules.engine-build.v1", contents) };
    verifyModuleEngineBuildArtifactV1(artifact, subject, plan, source);
  }
  const job: ReviewJob = { subject, state: "built", reviewRevision: 2, plan, planDigest: artifact.planDigest, artifact, attempt: 1, lastError: null, createdAt: "2026-09-07T01:00:00.000Z", updatedAt: "2026-09-07T01:10:00.000Z" };
  const identityFields = { sourceCommit: "a".repeat(40), runId: "123", runAttempt: "1", workflowRef: "programmablehq/programmable-open-hook-v2-internal/.github/workflows/protected-module-review-v1.yml@refs/heads/main" };
  const base = { attempt: 1, requestDigest: subject.requestDigest, planDigest: artifact.planDigest, errorCode: null };
  const attempts: ReviewAttempt[] = [
    { ...base, event: "claimed", artifactDigest: null, workerIdentity: { ...identityFields, identityDigest: reviewDigest("programmable.modules.worker-identity.v1", identityFields) }, createdAt: job.createdAt },
    { ...base, event: "completed", artifactDigest: artifact.artifactDigest, workerIdentity: null, createdAt: job.updatedAt },
  ];
  const detail = { schemaVersion: "programmable.modules.website-review-detail.v1", job, attempts, decisions: [] as ModuleReviewDecisionRecordV1[] };
  const codes = new Map<string, Hex>();
  const contracts = Object.fromEntries(MODULE_ENGINE_CONTRACTS.map((name, i) => { const address = a(200 + i), code = `0x60${(i + 1).toString(16).padStart(2, "0")}` as Hex; codes.set(address, code); return [name, { address, runtimeCodeHash: keccak256(code) }]; })) as ModuleEngineReleaseIdentity["contracts"];
  const raw = { schemaVersion: "programmable.module-engine.release.v1" as const, sourceVersion: "module-engine-v1" as const, engineProfile: "programmable.module-engine-solidity@1" as const, chainId: 4663 as const, sourceCommit: "e".repeat(40), startBlock: "1", tokenCreationCodeHash: h(30), economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2, finalityPolicy: MODULE_MODE_FINALITY_POLICY, contracts };
  const release = { ...raw, releaseDigest: computeModuleEngineReleaseDigest(raw) };
  const definition: EnginePublicationDefinition = { profile: "programmable.module-engine-solidity@1", catalogDefinition: {
    id: "fixture-engine", title: "Fixture engine", summary: "Synthetic test only.", detail: "Exact compiler wire fixture. Never approved.", version: source.descriptor.version, interface: "custom-v1", source: source.descriptor.source.files[0], schema: checked.request.descriptor.configuration, defaults: { cap: "5" }, configurationAbi: artifact.configurationAbi, constraints: [] },
    revision: { packageId: artifact.packageId, familyId: artifact.familyId, fixedQuoteAsset: a(0), fixedConfigurationHash: h(0), initialOperationId: h(0), executionGas: artifact.executionGas, moneyRights: artifact.moneyRights, coinRights: 0, operationPermissions: structuredClone(artifact.operationPermissions) as EnginePublicationDefinition["revision"]["operationPermissions"], eligibleFamilies: [artifact.familyId] } };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toMatch(/^https:\/\/programmable\.market\/api\/admin\/modules\/[0-9a-f-]+(?:\/source)?\?walletAddress=0x/u);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    return Response.json(String(url).includes("/source?") ? source : detail);
  });
  const reader = createAuthenticatedReviewReader({ walletAddress: reviewer, accessToken: "synthetic_test_session_0123456789" }, fetcher);
  const built = await reader.read(subject.submissionId), host = createEngineHostPreparation(built, release, definition);
  const accept = async (overrides: Partial<ModuleReviewDecisionRecordV1> = {}) => {
    const record: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = { schemaVersion: "programmable.modules.review-decision.v1", reviewerWallet: reviewer, policyDigest: h(55), subject,
      command: { schemaVersion: "programmable.modules.review-command.v1", submissionId: subject.submissionId, requestDigest: subject.requestDigest, expectedReviewRevision: 2, outcome: "accept", reason: "Synthetic test only; no review authority.", artifactDigest: artifact.artifactDigest, hostManifestHash: host.manifestHash, acknowledgedReviewAreas: [...artifact.reviewRequired] }, decidedAt: new Date().toISOString(), registryApproved: false, available: false, ...overrides };
    detail.decisions = [{ ...record, decisionDigest: computeModuleReviewDecisionDigestV1(record) }]; job.state = "accepted"; job.reviewRevision = 3;
    return reader.read(subject.submissionId);
  };
  const redigest = () => {
    const mutable = artifact as unknown as Record<string, unknown>, contents = Object.fromEntries(Object.entries(mutable).filter(([key]) => key !== "artifactDigest"));
    mutable.artifactDigest = reviewDigest("programmable.modules.engine-build.v1", contents); attempts[1].artifactDigest = mutable.artifactDigest as Hex;
  };
  return { source, subject, plan, artifact, job, detail, release, codes, definition, reader, fetcher, built, host, accept, redigest };
}
function providers(f: Awaited<ReturnType<typeof fixture>>, plan: EnginePublicationPlan) {
  const transactions = { family: h(70), revision: h(71) }, block = { number: "0x100", hash: h(72), timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: Object.values(transactions) };
  const revision = { ...plan.revision }, permissions = structuredClone(plan.manifest.manifest.revision.operationPermissions), offsets = [...plan.manifest.manifest.source.engine.immutableRuntimeOffsets];
  const log = { address: plan.release.contracts.host.address, removed: false, topics: encodeEventTopics({ abi: moduleEngineHostAbi, eventName: "EngineRevisionApproved", args: { revisionId: f.artifact.packageId, familyId: f.artifact.familyId } }), data: encodeAbiParameters(parseAbiParameters(ENGINE_REVISION), [revision]) };
  const rpc = vi.fn(async (method: string, params: unknown[]): Promise<unknown> => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return block;
    if (method === "eth_getCode") return f.codes.get(String(params[0])) ?? "0x";
    if (method === "eth_call") {
      const call = params[0] as { to: Address; data: Hex };
      if (call.to === f.release.contracts.host.address) {
        const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data: call.data }), name = decoded.functionName;
        if (name === "SOURCE_VERSION") return encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: name, result: MODULE_ENGINE_SOURCE_ID });
        if (["registry", "ledger", "tokenFactory", "launchPolicy"].includes(name)) return encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: name as "registry", result: f.release.contracts[name as "registry"].address });
        if (name === "getRevision") return encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: name, result: [revision, offsets, f.artifact.engine.immutableConstructorOffsets, plan.manifest.manifest.revision.eligibleFamilies] });
        if (name === "permission") return encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: name, result: permissions.find(p => p.operationId === decoded.args?.[1])! });
      }
      const decoded = decodeFunctionData({ abi: moduleEngineReadAbi, data: call.data }), name = decoded.functionName;
      if (name === "owner") return encodeFunctionResult({ abi: moduleEngineReadAbi, functionName: name, result: reviewer });
      if (name === "families") return encodeFunctionResult({ abi: moduleEngineReadAbi, functionName: name, result: [f.source.descriptor.author as Address, f.source.descriptor.rewardWallet as Address] });
      if (name === "ECONOMICS_POLICY_ID") return encodeFunctionResult({ abi: moduleEngineReadAbi, functionName: name, result: f.release.economicsPolicyId });
      if (["hook", "registry", "poolManager"].includes(name)) return encodeFunctionResult({ abi: moduleEngineReadAbi, functionName: name as "hook", result: f.release.contracts[name === "hook" ? "host" : name as "registry"].address });
    }
    const hash = params[0] as Hex, call = plan.calls[hash === transactions.family ? 0 : 1];
    if (method === "eth_getTransactionByHash") return { hash, from: call.from, to: call.to, input: call.data, value: call.value, chainId: "0x1237", blockHash: block.hash, blockNumber: block.number };
    if (method === "eth_getTransactionReceipt") return { transactionHash: hash, blockHash: block.hash, blockNumber: block.number, status: "0x1", transactionIndex: "0x0", logs: hash === transactions.revision ? [log] : [] };
    throw new Error("Unexpected test RPC");
  });
  return { providers: [0, 1].map(i => ({ providerId: `test${i}`, trustDomain: `independent${i}.invalid`, endpointCommitment: `sha256:${h(80 + i).slice(2)}`, rpc })) as PublicationProvider[], transactions, revision, permissions, offsets, log, block, rpc };
}

describe("Engine publication through the existing authenticated operator", () => {
  it("reads all eight scoped source aliases through the authenticated reader and canonical accepted publication", async () => {
    const f = await fixture(true), input = moduleEngineStandardInputV1(f.source, f.subject, f.plan);
    for (const prefix of scopedPrefixes) {
      expect(input.sources[`@${prefix}Probe.sol`].content).toBe("// exact source bytes\npragma solidity 0.8.26;\n");
      expect(Object.hasOwn(input.sources, `dependencies/scoped/${prefix}Probe.sol`)).toBe(false);
    }
    const accepted = await f.accept(), publication = prepareEnginePublication(accepted, f.release, f.definition, reviewer);
    expect(publication.manifest).toEqual(f.host.manifest);
    expect(publication.calls.map(call => call.action)).toEqual(["registerReviewedFamily", "approveRevision"]);
    expect(() => requireAuthenticatedReview(structuredClone(accepted))).toThrow("authenticated");
  });
  it.each(["input", "compiler", "image", "settings", "reproducible", "worker"])("keeps scoped Engine %s provenance exact after profile dispatch", async field => {
    const f = await fixture(true), compiler = f.artifact.compiler as unknown as Record<string, unknown>;
    if (field === "input") {
      const sources = Object.fromEntries(f.source.files.filter(file => file.path.endsWith(".sol")).map(file => [file.path, { content: Buffer.from(file.bytes, "base64").toString("utf8") }]));
      compiler.completeInputHash = reviewDigest("programmable.modules.compiler-input.v1", { language: "Solidity", sources, settings: NATIVE_SETTINGS });
    }
    if (field === "compiler") compiler.binarySha256 = `sha256:${"11".repeat(32)}`;
    if (field === "image") compiler.imageDigest = `sha256:${"11".repeat(32)}`;
    if (field === "settings") compiler.settingsHash = h(90);
    if (field === "reproducible") compiler.reproducible = false;
    if (field === "worker") {
      const identity = { ...f.detail.attempts[0].workerIdentity!, workflowRef: "unreviewed-workflow" }, { identityDigest: _old, ...contents } = identity; void _old;
      f.detail.attempts[0].workerIdentity = { ...contents, identityDigest: reviewDigest("programmable.modules.worker-identity.v1", contents) };
    }
    f.redigest(); await expect(f.reader.read(f.subject.submissionId)).rejects.toThrow();
  });
  it("reads the exact backend engine build and prepares the complete Host admission without availability", async () => {
    const f = await fixture(); expect(parseReviewJob(f.job)).toEqual(f.job);
    expect(() => prepareEnginePublication(f.built, f.release, f.definition, reviewer)).toThrow("accepted");
    const accepted = await f.accept(), plan = prepareEnginePublication(accepted, f.release, f.definition, reviewer);
    expect(plan.calls).toHaveLength(2); expect(plan.calls.map(c => c.to)).toEqual([f.release.contracts.registry.address, f.release.contracts.host.address]);
    expect(plan.calls.every(c => c.from === reviewer && c.value === "0x0")).toBe(true);
    const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data: plan.calls[1].data });
    expect(decoded).toEqual({ functionName: "approveRevision", args: [f.artifact.packageId, plan.revision, f.artifact.engine.immutableRuntimeOffsets, f.artifact.engine.immutableConstructorOffsets, f.artifact.operationPermissions, [f.artifact.familyId]] });
    expect(plan.catalogPreparation.entries[0]).toMatchObject({ status: "prepared", available: false, manifestHash: f.host.manifestHash });
    expect(() => requireAuthenticatedReview(structuredClone(accepted))).toThrow("authenticated");
  });
  it.each(["manifest", "prepare", "export"])("dispatches %s through the existing session and operator with private nonavailable output", async command => {
    const f = await fixture(), accepted = await f.accept(), plan = prepareEnginePublication(accepted, f.release, f.definition, reviewer), p = providers(f, plan);
    const parent = await mkdtemp(path.join(await realpath(tmpdir()), "engine-publication-test-")), privateParent = path.join(parent, "private");
    await mkdir(privateParent, { mode: 0o700 });
    const output = path.join(privateParent, "result");
    const values = { identity: f.release, definition: f.definition, "session-file": { walletAddress: reviewer, accessToken: "synthetic_test_session_0123456789" }, transactions: p.transactions };
    for (const [name, value] of Object.entries(values)) await writeFile(path.join(parent, `${name}.json`), JSON.stringify(value), { mode: 0o600 });
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).startsWith("https://programmable.market/")) return f.fetcher(url, init);
      const body = JSON.parse(String(init?.body)); return Response.json({ jsonrpc: "2.0", id: body.id, result: await p.rpc(body.method, body.params) });
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetcher);
    try {
      await run([command, "--identity", path.join(parent, "identity.json"), "--definition", path.join(parent, "definition.json"), "--submission", f.subject.submissionId,
        "--session-file", path.join(parent, "session-file.json"), "--output", output, ...(command === "export" ? ["--transactions", path.join(parent, "transactions.json")] : [])],
      { repositoryRoot: process.cwd(), providers: async () => p.providers.map((provider, i) => ({ ...provider, url: `https://rpc${i}.example.invalid` })) });
      const manifest = JSON.parse(await readFile(path.join(output, command === "manifest" ? "manifest.json" : "unsigned-plan.json"), "utf8"));
      expect(command === "manifest" ? manifest : manifest.manifest).toEqual(f.host.manifest);
      expect(JSON.parse(await readFile(path.join(output, "review-build.json"), "utf8"))).toEqual({ subject: f.subject, plan: f.plan, artifact: f.artifact });
      if (command !== "manifest") expect(JSON.parse(await readFile(path.join(output, "catalog-preparation.json"), "utf8")).entries[0]).toMatchObject({ available: false, status: "prepared" });
      if (command === "export") {
        expect(JSON.parse(await readFile(path.join(output, "export.complete.json"), "utf8"))).toMatchObject({ available: false, websitePublished: false, ethereumFinalityProven: false });
        expect(JSON.parse(await readFile(path.join(output, "public", "developers", "modules", f.artifact.packageId, "source.json"), "utf8"))).toEqual(f.source);
        await expect(readFile(path.join(output, "public", "developers", "modules", f.artifact.packageId, "review-build.json"))).rejects.toThrow();
      }
    } finally { vi.unstubAllGlobals(); log.mockRestore(); await rm(parent, { recursive: true, force: true }); }
  });
  it("accepts bounded monotonic Engine timestamps and rejects backward or out-of-range vectors", async () => {
    const f = await fixture();
    const plan = { ...f.plan, cases: f.plan.cases.map((c,i) => i === 0 ? { ...c, operations: c.operations.map((o,j) => ({ ...o, timestamp: 1800000000 + j * 3600 })) } : c) };
    expect(parseReviewPlan(plan, f.subject)).toEqual(plan);
    for (const timestamp of [1799999999, 1831536001, 1800000000.1, "1800000010"]) {
      const bad = structuredClone(plan) as unknown as { cases: { operations: { timestamp: unknown }[] }[] };
      bad.cases[0].operations[2].timestamp = timestamp;
      expect(() => parseReviewPlan(bad, f.subject)).toThrow();
    }
  });
  it("reconstructs named tuple configuration through the shared engine encoder", async () => {
    const f = await fixture();
    const configurationAbi = [{ path: [], type: "tuple", components: [{ name: "cap", type: "uint64" }] }];
    const plan = { ...f.plan, configurationAbi }, planDigest = reviewDigest("programmable.modules.engine-build-plan.v1", plan);
    const { artifactDigest: _old, ...contents } = { ...f.artifact, configurationAbi, planDigest, tests: { ...f.artifact.tests, planDigest } };
    void _old;
    const artifact = { ...contents, artifactDigest: reviewDigest("programmable.modules.engine-build.v1", contents) };
    expect(parseReviewPlan(plan, f.subject)).toEqual(plan);
    expect(() => verifyModuleEngineBuildArtifactV1(artifact, f.subject, plan, f.source)).not.toThrow();
    for (const bad of [
      [{ path: [], type: "tuple", components: [] }],
      [{ path: [], type: "tuple", components: [{ name: "cap", type: "uint64" }, { name: "cap", type: "uint64" }] }],
      [{ path: [], type: "uint64", components: [{ name: "cap", type: "uint64" }] }],
    ]) expect(() => parseReviewPlan({ ...plan, configurationAbi: bad }, f.subject)).toThrow();
  });
  it("matches fixed/general Host admission and initial operation to the same successful configuration", async () => {
    const f = await fixture(), checked = validateModuleSubmissionRequest(f.source); if (!checked.ok) throw new Error("fixture");
    const cases = f.artifact.cases.map(c => ({ ...c, fixedConfiguration: true }));
    const job = { plan: f.plan, artifact: { ...f.artifact, cases } };
    const make = (revision: EnginePublicationDefinition["revision"]) => createReviewedModuleEngineManifest({ job, release: f.release, descriptor: checked.request.descriptor, definition: f.definition.catalogDefinition, revision });
    expect(() => make(f.definition.revision)).toThrow("admission");
    const revision = { ...f.definition.revision, fixedConfigurationHash: cases[1].configHash, fixedQuoteAsset: cases[1].quoteAsset };
    expect(() => make(revision)).not.toThrow();
    expect(() => make({ ...revision, initialOperationId: cases[0].operations[1].operationId })).toThrow("Initial operation");
    const noFlag = { ...f.plan, cases: f.plan.cases.map(c => ({ ...c, fixedConfiguration: "true" })) };
    expect(() => parseReviewPlan(noFlag, f.subject)).toThrow("ADMISSION");
  });
  it.each(["source", "compiler", "instance", "tests", "patches"])("rejects substituted %s even when its artifact digest is recomputed", async area => {
    const f = await fixture(), mutable = f.artifact as unknown as typeof frozen.artifact;
    if (area === "source") f.source.files[0].bytes = Buffer.from("contract Fake {}").toString("base64");
    if (area === "compiler") mutable.compiler.binarySha256 = `sha256:${"11".repeat(32)}`;
    if (area === "instance") mutable.cases[0].constructorHash = h(90);
    if (area === "tests") mutable.tests.cases[0].operations[0].feesBacked = false;
    if (area === "patches") mutable.engine.immutableConstructorOffsets[0] = 160;
    f.redigest(); await expect(f.reader.read(f.subject.submissionId)).rejects.toThrow();
  });
  it.each(["moneyRights", "operationPermissions", "executionGas", "fixedQuoteAsset", "fixedConfigurationHash"])("rejects unreviewed %s", async field => {
    const f = await fixture(), accepted = await f.accept(), definition = structuredClone(f.definition);
    if (field === "moneyRights") definition.revision.moneyRights = 7;
    if (field === "operationPermissions") definition.revision.operationPermissions[3].authorization = 0;
    if (field === "executionGas") definition.revision.executionGas++;
    if (field === "fixedQuoteAsset") definition.revision.fixedQuoteAsset = a(999);
    if (field === "fixedConfigurationHash") definition.revision.fixedConfigurationHash = h(999);
    expect(() => prepareEnginePublication(accepted, f.release, definition, reviewer)).toThrow();
  });
  it("requires an independent reviewer and the current immutable manifest revision", async () => {
    const f = await fixture();
    await expect(f.accept({ reviewerWallet: f.subject.author })).rejects.toThrow("decisions");
    const accepted = await f.accept(), changed = structuredClone(f.definition); changed.catalogDefinition.summary = "Changed interpretation.";
    expect(() => prepareEnginePublication(accepted, f.release, changed, reviewer)).toThrow("manifest");
    f.job.reviewRevision++; const later = await f.reader.read(f.subject.submissionId);
    expect(() => prepareEnginePublication(later, f.release, f.definition, reviewer)).toThrow("accepted");
  });
  it("binds both RPC providers, host relationships, exact revision, patches, rights, transaction and admission event", async () => {
    const f = await fixture(), accepted = await f.accept(), plan = prepareEnginePublication(accepted, f.release, f.definition, reviewer), p = providers(f, plan);
    expect(await readEnginePublicationOwner(f.release, p.providers)).toBe(reviewer);
    expect(await observeEnginePublicationReadback(plan, accepted, p.providers, p.transactions)).toMatchObject({ status: "canonical-inclusion-verified", finality: "separate-robinhood-ethereum-finality-proof-required", available: false, revision: plan.revision });
    expect(p.rpc.mock.calls.every(([method]) => !method.includes("send") && !method.includes("sign"))).toBe(true);
  });
  it.each(["offset", "permission", "revision", "event", "code", "provider"])("rejects %s substitution in actual publication readback", async field => {
    const f = await fixture(), accepted = await f.accept(), plan = prepareEnginePublication(accepted, f.release, f.definition, reviewer), p = providers(f, plan);
    if (field === "offset") p.offsets[0]++;
    if (field === "permission") p.permissions[3].authorization = 0;
    if (field === "revision") p.revision.moneyRights = 7;
    if (field === "event") p.log.data = "0x";
    if (field === "code") f.codes.set(f.release.contracts.host.address, "0x6000");
    if (field === "provider") p.providers[1].trustDomain = p.providers[0].trustDomain;
    await expect(observeEnginePublicationReadback(plan, accepted, p.providers, p.transactions)).rejects.toThrow();
  });
});

describe("Engine review BFF keeps existing private authority", () => {
  async function setup(installed: boolean) {
    const f = await fixture();
    const backend = vi.fn<typeof fetch>(async url => Response.json(String(url).endsWith("/source") ? f.source : { ...f.detail, schemaVersion: "programmable.modules.review-detail.v1" }));
    const client = createModuleReviewClient({ authenticator: { async authenticate() { return { privyUserId: "did:privy:test-reviewer", privySessionId: "test-session", wallets: [reviewer] }; } }, backendBaseUrl: "https://review.example.invalid", websiteToken: `service_${"a".repeat(48)}`, bffAssertionKeyV2: `assert_${"b".repeat(48)}`, fetchBackend: backend, ...(installed ? { engineReleaseIdentity: f.release } : {}) });
    const request = (manifest = f.host.manifest) => new Request(`https://programmable.market/api/admin/modules/${f.subject.submissionId}/manifest`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-test" }, body: JSON.stringify({ walletAddress: reviewer, expectedReviewRevision: 2, hostManifestJson: JSON.stringify(manifest) }) });
    return { ...f, client, backend, request };
  }
  it("requires the installed Engine identity, independent of a user-supplied valid manifest", async () => {
    const f = await setup(false), response = await f.client.handle(f.request(), "manifest", f.subject.submissionId);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code: "MODULE_REVIEW_HOST_RELEASE_UNAVAILABLE" } });
  });
  it("checks the same complete engine manifest with the installed identity", async () => {
    const f = await setup(true), response = await f.client.handle(f.request(), "manifest", f.subject.submissionId);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ artifactDigest: f.artifact.artifactDigest, hostManifestHash: f.host.manifestHash });
    const changed = structuredClone(f.host.manifest); changed.manifest.revision.moneyRights = 7;
    expect((await f.client.handle(f.request(changed), "manifest", f.subject.submissionId)).status).toBe(400);
    expect(f.backend.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
});
