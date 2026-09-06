import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbiParameters, type Hex } from "viem";
import { moduleReviewAdminFixture } from "./fixtures/module-review-admin";
import { a, h } from "./fixtures/module-mode-evidence";
import { computeModuleModeReleaseDigest } from "../lib/module-mode/release";
import { reviewDigest } from "../lib/module-mode/review-contract";
import { computeModuleReviewDecisionDigestV1, type ModuleReviewDecisionRecordV1 } from "../lib/server/module-mode/review-decision-wire-v1";
import { moduleSubmissionFromPack, validateModuleSubmissionRequest, type ModuleSubmissionRequest } from "../packages/classic-modules/src/open-transport.mjs";
import { loadOpenSourcePackage } from "../packages/classic-modules/src/open-package-io.mjs";
import { createAuthenticatedReviewReader, NATIVE_COMPILER, NATIVE_SETTINGS, requireAuthenticatedReview, acceptedDecision } from "../ops/module-mode-publication/review";
import { CREATE2_DEPLOYER, REGISTRY_ABI, createHostPreparation, prepareModulePublication } from "../ops/module-mode-publication/core";
import { observePublicationReadback, publicationRpc, readPublicationOwner, type PublicationProvider } from "../ops/module-mode-publication/rpc";

// Synthetic parser/RPC evidence only. Never upload these fixtures or treat them as review or chain proof.
async function fixture() {
  const f = moduleReviewAdminFixture();
  const source = structuredClone(f.source);
  for (const c of source.descriptor.components) c.runtime = "programmable.native-solidity@1";
  const checked = validateModuleSubmissionRequest(source); if (!checked.ok) throw new Error("fixture");
  const subject = { ...f.subject, requestDigest: checked.requestDigest };
  const plan = { ...f.plan, requestDigest: checked.requestDigest, configurationCodec: "programmable.native-abi@1" as const, programAbi: f.definition.programAbi! };
  const planDigest = reviewDigest("programmable.modules.native-build-plan.v1", plan);
  const sources = Object.fromEntries(source.files.filter(file => file.path.endsWith(".sol")).map(file => [file.path, { content: Buffer.from(file.bytes, "base64").toString("utf8") }]));
  const artifact = { ...f.artifact, subject, packageId: checked.packageId, familyId: checked.familyId, planDigest, configurationCodec: plan.configurationCodec, programAbi: plan.programAbi,
    sourceManifestHash: reviewDigest("programmable.modules.source-manifest.v1", source.descriptor),
    compiler: { ...NATIVE_COMPILER, settingsHash: reviewDigest("programmable.modules.compiler-settings.v1", NATIVE_SETTINGS),
      completeInputHash: reviewDigest("programmable.modules.compiler-input.v1", { language: "Solidity", sources, settings: NATIVE_SETTINGS }), reproducible: true as const },
    tests: { ...f.artifact.tests, requestDigest: checked.requestDigest, planDigest } };
  const digestArtifact = () => { const contents = Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "artifactDigest")); artifact.artifactDigest = reviewDigest("programmable.modules.native-build.v1", contents); };
  digestArtifact();
  const detail = structuredClone(f.detail);
  detail.job = { ...f.job, subject, plan, planDigest, artifact };
  detail.source.descriptor = source.descriptor; detail.source.packageId = checked.packageId;
  detail.attempts = [{ ...detail.attempts[0], requestDigest: checked.requestDigest, planDigest, artifactDigest: artifact.artifactDigest,
    workerIdentity: { ...detail.attempts[0].workerIdentity!, workflowRef: "programmablehq/programmable-open-hook-v2-internal/.github/workflows/protected-module-review-v1.yml@refs/heads/main" } }];
  const release = structuredClone(f.release);
  const codes = new Map<string, Hex>(); let index = 0;
  for (const pin of Object.values(release.contracts)) { const code = `0x60${(++index).toString(16).padStart(2, "0")}` as Hex; (pin as { runtimeCodeHash: Hex }).runtimeCodeHash = keccak256(code); codes.set(pin.address, code); }
  (release as { releaseDigest: Hex }).releaseDigest = computeModuleModeReleaseDigest(release);
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toMatch(/^https:\/\/programmable\.market\/api\/admin\/modules\/[0-9a-f-]+(?:\/source)?\?walletAddress=0x/u);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    return Response.json(String(url).includes("/source?") ? source : detail);
  });
  const reader = createAuthenticatedReviewReader({ walletAddress: f.reviewer, accessToken: "test_fixture_session_0123456789" }, fetchImpl);
  const built = await reader.read(subject.submissionId);
  const host = createHostPreparation(built, release, f.definition);
  const accept = async () => {
    const contents: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = { schemaVersion: "programmable.modules.review-decision.v1", subject,
      reviewerWallet: f.reviewer, policyDigest: f.policyDigest, decidedAt: new Date().toISOString(), registryApproved: false, available: false,
      command: { schemaVersion: "programmable.modules.review-command.v1", submissionId: subject.submissionId, requestDigest: subject.requestDigest,
        expectedReviewRevision: detail.job.reviewRevision, outcome: "accept", reason: "Synthetic publication test only, never public review authority.",
        artifactDigest: artifact.artifactDigest, hostManifestHash: host.manifestHash, acknowledgedReviewAreas: artifact.reviewRequired } };
    detail.decisions = [{ ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) }];
    detail.job.state = "accepted"; detail.job.reviewRevision++;
    return reader.read(subject.submissionId);
  };
  return { ...f, source, subject, artifact, detail, release, codes, reader, fetchImpl, built, host, accept, digestArtifact };
}

// Real SDK source inventory with synthetic review/build evidence, never protected-worker authority.
async function starterFixture(changeSource?: (source: ModuleSubmissionRequest) => void) {
  const f = await fixture();
  const source = moduleSubmissionFromPack(await loadOpenSourcePackage(fileURLToPath(new URL("../packages/classic-modules/examples/native-program/", import.meta.url)), "module.json"));
  expect(source.files).toHaveLength(28);
  changeSource?.(source);
  const checked = validateModuleSubmissionRequest(source); if (!checked.ok) throw new Error("starter source fixture");
  const subject = { ...f.subject, author: source.descriptor.author.toLowerCase(), requestDigest: checked.requestDigest };
  const programAbi = [
    { path: ["everyN"], type: "uint32" }, { path: ["minimumGrossNative"], type: "uint128" }, { path: ["rewardNative"], type: "uint128" },
    { path: ["endsAt"], type: "uint64" }, { path: ["includeInitialBuy"], type: "bool" }, { path: ["refundWallet"], type: "address" },
  ];
  const parameters = JSON.parse(Buffer.from(source.files.find(file => file.path === "configuration.fixture.json")!.bytes, "base64").toString("utf8"));
  const plan = { ...f.detail.job.plan!, requestDigest: checked.requestDigest, programComponentId: "reward", programAbi,
    cases: [{ ...f.detail.job.plan!.cases[0], parameters }] };
  const planDigest = reviewDigest("programmable.modules.native-build-plan.v1", plan);
  const configBytes = encodeAbiParameters(parseAbiParameters("uint32,uint128,uint128,uint64,bool,address"), [3, 10_000_000_000_000_000n, 1_000_000_000_000_000n, 2_000_000_000n, false, parameters.refundWallet]);
  const configHash = keccak256(configBytes);
  const artifact = { ...f.artifact, subject, packageId: checked.packageId, familyId: checked.familyId, rewardWallet: source.descriptor.rewardWallet.toLowerCase(), planDigest, programAbi,
    sourceManifestHash: reviewDigest("programmable.modules.source-manifest.v1", source.descriptor),
    configurationSchemaHash: reviewDigest("programmable.modules.configuration-schema.v1", source.descriptor.configuration),
    // Independent backend 9944a2df standard-input hash: 11 submitted Solidity files + 4 fixed aliases.
    compiler: { ...f.artifact.compiler, completeInputHash: "0x58037801a75a5acf6c20a0ae0b8448af06fab1dcc5a25eac0c58a69757fb86e4" as Hex },
    cases: [{ ...plan.cases[0], configBytes, configHash, abiParameters: programAbi.map(({ type }) => ({ type })) }],
    tests: { ...f.artifact.tests, requestDigest: checked.requestDigest, planDigest, cases: [{ ...f.artifact.tests.cases[0], configHash }] } };
  for (const role of ["factory", "program"] as const) {
    const component = source.descriptor.components.find(c => c.id === plan[`${role}ComponentId`])!;
    artifact[role] = { ...artifact[role], componentId: component.id, sourcePath: component.sourcePath, contractName: component.entrypoint };
  }
  f.detail.job = { ...f.detail.job, subject, plan, planDigest, artifact };
  const digestArtifact = () => {
    const contents = Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "artifactDigest"));
    artifact.artifactDigest = reviewDigest("programmable.modules.native-build.v1", contents);
    Object.assign(f.detail.attempts[0], { requestDigest: checked.requestDigest, planDigest, artifactDigest: artifact.artifactDigest });
  };
  digestArtifact();
  f.fetchImpl.mockImplementation(async url => Response.json(String(url).includes("/source?") ? source : f.detail));
  return { source, subject, artifact, reader: f.reader, digestArtifact };
}

function providers(f: Awaited<ReturnType<typeof fixture>>, plan: ReturnType<typeof prepareModulePublication>) {
  const transactions = { factory: h(70), family: h(71), revision: h(72) };
  const block = { number: "0x100", hash: h(50), timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: Object.values(transactions) };
  const b = plan.publication.entry.nativeBinding;
  const revision = { familyId: b.familyId, factory: b.factory, factoryCodeHash: b.factoryCodeHash, moduleCodeHash: b.moduleCodeHash, manifestHash: b.manifestHash, callbackGas: b.callbackGas, enabled: true };
  const map = new Map(Object.values(transactions).map((hash, i) => [hash, plan.calls[i]]));
  const log = { address: plan.release.contracts.registry.address, topics: encodeEventTopics({ abi: REGISTRY_ABI, eventName: "RevisionApproved", args: { packageId: b.packageId, familyId: b.familyId } }),
    data: encodeAbiParameters(parseAbiParameters("(bytes32 familyId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas,bool enabled)"), [revision]), removed: false };
  const rpc = vi.fn(async (method: string, params: unknown[]): Promise<unknown> => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return block;
    if (method === "eth_getCode") {
      if (params[0] === CREATE2_DEPLOYER.address) return "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
      if (params[0] === b.factory) return f.artifact.factory.runtimeBytecode;
      return f.codes.get(String(params[0])) ?? "0x";
    }
    if (method === "eth_call") {
      const decoded = decodeFunctionData({ abi: REGISTRY_ABI, data: (params[0] as { data: Hex }).data });
      if (decoded.functionName === "owner") return encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "owner", result: f.reviewer });
      if (decoded.functionName === "families") return encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "families", result: [f.source.descriptor.author as Hex, f.source.descriptor.rewardWallet as Hex] });
      if (decoded.functionName === "getRevision") return encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "getRevision", result: revision });
    }
    const hash = params[0] as Hex, call = map.get(hash)!;
    if (method === "eth_getTransactionByHash") return { hash, from: call.from, to: call.to, input: call.data, value: call.value, chainId: "0x1237", blockHash: block.hash, blockNumber: block.number };
    if (method === "eth_getTransactionReceipt") return { transactionHash: hash, blockHash: block.hash, blockNumber: block.number, status: "0x1", transactionIndex: "0x0", logs: call.action === "approveRevision" ? [log] : [] };
    throw new Error("Unexpected fixture RPC");
  });
  const result: PublicationProvider[] = [0, 1].map(i => ({ providerId: `fixture${i}`, trustDomain: `independent${i}.invalid`, endpointCommitment: `sha256:${h(i + 11).slice(2)}`, rpc }));
  return { providers: result, transactions, block, revision, rpc, log };
}

describe("Generic module publication authority and binding", () => {
  it("accepts the unchanged 28-file starter using the protected compiler's exact fixed import aliases", async () => {
    const f = await starterFixture();
    const built = await f.reader.read(f.subject.submissionId);
    expect(built.source.descriptor.components.find(c => c.id === "reward")?.runtime).toBe("programmable.module-native-runtime@1");
    expect(built.artifact.compiler.completeInputHash).toBe(f.artifact.compiler.completeInputHash);
    f.artifact.compiler.completeInputHash = "0x2a19797ce754dfa9dcdde7fc7491acb7cc807fc4dfbe34abfac3df39e2ac8dfd";
    f.digestArtifact();
    await expect(f.reader.read(f.subject.submissionId)).rejects.toThrow("Pinned compiler/input");
  });
  it("binds aliased dependency bytes and never takes remapping instructions from submitted Foundry config", async () => {
    const changed = async (path: string, text: string) => starterFixture(source => {
      const file = source.files.find(file => file.path === path)!;
      const bytes = Buffer.from(text);
      file.bytes = bytes.toString("base64"); file.sha256 = createHash("sha256").update(bytes).digest("hex");
      source.descriptor.source.files.find(pin => pin.path === path)!.sha256 = file.sha256;
    });
    const dependency = await changed("dependencies/openzeppelin-contracts/contracts/utils/Errors.sol", "// Altered dependency\nlibrary Errors {}\n");
    await expect(dependency.reader.read(dependency.subject.submissionId)).rejects.toThrow("Pinned compiler/input");
    const config = await changed("foundry.toml", 'remappings = ["@openzeppelin/contracts/=https://untrusted.invalid/"]\n');
    await expect(config.reader.read(config.subject.submissionId)).resolves.toHaveProperty("artifact.compiler.completeInputHash", config.artifact.compiler.completeInputHash);
  });
  it("constructs an exact CREATE2 host manifest before review without fake approval", async () => {
    const f = await fixture(); expect(f.host.status).toBe("review-required"); expect(f.host.manifest.manifest.runtimeBinding.factory).toMatch(/^0x[0-9a-f]{40}$/u);
    expect(() => prepareModulePublication(f.built, f.release, f.definition, f.reviewer)).toThrow("Current accepted");
    expect(f.source.descriptor.source).not.toHaveProperty("repository");
  });
  it("rejects untrusted JSON, edited authenticated snapshots and stale reads", async () => {
    const f = await fixture(); expect(() => requireAuthenticatedReview(structuredClone(f.built))).toThrow();
    f.built.job.reviewRevision++; expect(() => requireAuthenticatedReview(f.built)).toThrow();
    const current = await f.reader.read(f.subject.submissionId);
    vi.spyOn(Date, "now").mockReturnValue(current.observedAt + 300_001);
    try { expect(() => requireAuthenticatedReview(current)).toThrow(); } finally { vi.restoreAllMocks(); }
  });
  it("binds accepted source/build/manifest to generic unsigned factory/family/revision calls", async () => {
    const f = await fixture(), reviewed = await f.accept();
    const plan = prepareModulePublication(reviewed, f.release, f.definition, f.reviewer);
    expect(plan.calls.map(c => c.action)).toEqual(["deployFactory", "registerReviewedFamily", "approveRevision"]);
    expect(plan.calls.every(c => c.chainId === 4663 && c.value === "0x0")).toBe(true);
    expect(plan.calls[0].data).toBe(`${f.host.salt}${f.artifact.factory.creationBytecode.slice(2)}`);
    expect(plan.publication.entry.nativeBinding.reviewDigest).toBe(acceptedDecision(reviewed).decisionDigest);
    expect(() => prepareModulePublication(reviewed, f.release, { ...f.definition, title: "Unreviewed title" }, f.reviewer)).toThrow("another host");
    expect(() => createHostPreparation(reviewed, f.release, { ...f.definition, programAbi: [{ path: ["capNative"], type: "uint256" }] })).toThrow("ABI mapping");
  });
  it("rejects stale review revision and an incomplete review scope", async () => {
    const f = await fixture(); await f.accept(); f.detail.job.reviewRevision++;
    const value = await f.reader.read(f.subject.submissionId); expect(() => acceptedDecision(value)).toThrow("Current accepted");
    const other = await fixture(); await other.accept();
    const record = { ...other.detail.decisions[0], command: { ...other.detail.decisions[0].command, acknowledgedReviewAreas: [] } };
    const contents = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "decisionDigest")) as unknown as Omit<ModuleReviewDecisionRecordV1, "decisionDigest">;
    other.detail.decisions[0] = { ...contents, decisionDigest: computeModuleReviewDecisionDigestV1(contents) };
    const incomplete = await other.reader.read(other.subject.submissionId); expect(() => acceptedDecision(incomplete)).toThrow("Current accepted");
  });
  it("checks compiler, component and real worker provenance even when artifact hashes are recomputed", async () => {
    for (const change of [
      (f: Awaited<ReturnType<typeof fixture>>) => { Object.assign(f.artifact.compiler, { version: "other" }); },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.artifact.program.sourcePath = "src/Other.sol"; },
      (f: Awaited<ReturnType<typeof fixture>>) => { f.detail.attempts[0].workerIdentity!.workflowRef = "untrusted/workflow"; },
    ]) {
      const f = await fixture(); change(f); f.digestArtifact(); f.detail.attempts[0].artifactDigest = f.artifact.artifactDigest;
      await expect(f.reader.read(f.subject.submissionId)).rejects.toThrow();
    }
  });
  it("rejects unauthorized/redirected source reads and never leaks an upstream secret", async () => {
    const f = await fixture();
    f.fetchImpl.mockImplementation(async () => { throw new Error("credential-canary-private"); });
    await expect(f.reader.read(f.subject.submissionId)).rejects.toThrow("Authenticated module review read failed");
    f.fetchImpl.mockImplementation(async () => Response.json({ secret: "credential-canary-private" }, { status: 403 }));
    await expect(f.reader.read(f.subject.submissionId)).rejects.not.toThrow("credential-canary-private");
    f.fetchImpl.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://other.invalid" } }));
    await expect(f.reader.read(f.subject.submissionId)).rejects.toThrow("Authenticated module review read failed");
  });
});

describe("Onchain module publication proof", () => {
  it("verifies two providers, pinned release/factory, exact admission tx and current Registry state", async () => {
    const f = await fixture(), reviewed = await f.accept(), plan = prepareModulePublication(reviewed, f.release, f.definition, f.reviewer);
    const p = providers(f, plan);
    expect(await readPublicationOwner(f.release, p.providers)).toBe(f.reviewer);
    const evidence = await observePublicationReadback(plan, reviewed, p.providers, p.transactions);
    expect(evidence.status).toBe("canonical-inclusion-verified"); expect(evidence.receipts).toHaveLength(3);
    expect(evidence.finality).toBe("separate-robinhood-ethereum-finality-proof-required");
  });
  it("can reuse an already registered exact family without pretending to register it again", async () => {
    const f = await fixture(), reviewed = await f.accept(), plan = prepareModulePublication(reviewed, f.release, f.definition, f.reviewer), p = providers(f, plan);
    const evidence = await observePublicationReadback(plan, reviewed, p.providers, { ...p.transactions, family: null }); expect(evidence.receipts).toHaveLength(2);
  });
  it("rejects provider disagreement, wrong chain, changed code, disabled revision, absent event and reorg", async () => {
    const mutations = [
      (p: ReturnType<typeof providers>) => { p.providers[1] = { ...p.providers[1], rpc: async (m, args) => m === "eth_chainId" ? "0x1" : p.rpc(m, args) }; },
      (p: ReturnType<typeof providers>) => { p.providers[1] = { ...p.providers[1], trustDomain: p.providers[0].trustDomain }; },
      (p: ReturnType<typeof providers>) => { p.providers[1] = { ...p.providers[1], rpc: async (m, args) => m === "eth_getCode" ? "0x00" : p.rpc(m, args) }; },
      (p: ReturnType<typeof providers>) => { p.revision.enabled = false; },
      (p: ReturnType<typeof providers>) => { p.log.removed = true; },
      (p: ReturnType<typeof providers>) => { p.block.transactions = []; },
    ];
    for (const mutate of mutations) {
      const f = await fixture(), reviewed = await f.accept(), plan = prepareModulePublication(reviewed, f.release, f.definition, f.reviewer), p = providers(f, plan); mutate(p);
      await expect(observePublicationReadback(plan, reviewed, p.providers, p.transactions)).rejects.toThrow();
    }
  });
  it("rejects altered prepared calldata and unrelated receipt hashes", async () => {
    const f = await fixture(), reviewed = await f.accept(), plan = prepareModulePublication(reviewed, f.release, f.definition, f.reviewer), p = providers(f, plan);
    plan.calls[2].to = a(42); await expect(observePublicationReadback(plan, reviewed, p.providers, p.transactions)).rejects.toThrow("Publication plan differs");
  });
  it("RPC reader forbids signing/sending and sanitizes transport failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("private-rpc-canary"); });
    const rpc = publicationRpc("https://example.invalid/private-rpc-canary", fetchImpl);
    await expect(rpc("eth_sendTransaction", [])).rejects.toThrow("Read-only"); expect(fetchImpl).not.toHaveBeenCalled();
    await expect(rpc("eth_getCode", [])).rejects.toThrow("Publication eth_getCode read failed");
  });
});
