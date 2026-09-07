import "server-only";

import { createReviewedModuleEngineManifest } from "@/lib/module-mode/review-engine-manifest";
import { verifyModuleEngineBuildArtifactV1 } from "@/lib/module-mode/review-engine-contract";
import { bindModuleEngineReleaseIdentity, computeModuleEngineHostManifestHash, type ModuleEngineCatalogDefinition, type ModuleEngineRevisionDefinition } from "@/lib/module-engine/catalog";
import { randomBytes } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import configuredRelease from "@/config/module-mode/robinhood.preview.json";
import configuredEngineReviewRelease from "@/config/module-engine/review-release.json";
import { isReviewId, parseReviewAttempt, parseReviewJob, parseReviewPlan, reviewDigest, reviewRecord, parseReviewQueueItem, type ReviewDetail } from "@/lib/module-mode/review-contract";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import { unsupportedManagementCapabilities } from "@/lib/module-mode/management-manifest";
import { validateModuleSubmissionRequest, MODULE_TRANSPORT_LIMITS } from "@/packages/classic-modules/src/open-transport.mjs";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1, type WalletPrincipalAuthenticatorV1 } from "../creator-article/wallet-principal.server";
import { createWalletAdminBffAssertionV2, requireWalletAdminBffAssertionKeyV2 } from "../custom-launch/wallet-admin-bff-assertion-v2";
import { parseStrictJson } from "../projection-target/canonical-json";
import { createModuleModeHostManifest, computeModuleModeHostManifestHash, type ModuleModeCatalogDefinition, type ModuleModeHostReleaseIdentity } from "./catalog";
import { validateModuleReviewDecisionCommandV1, validateModuleReviewDecisionRecordV1 } from "./review-decision-wire-v1";

type Operation = "list" | "detail" | "source" | "plan" | "manifest" | "decision";
const BACKEND_PATH = "/v1/wallet-admin/module-review";
const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", Vary: "Authorization, X-Privy-Identity-Token" };
const BROWSER_LIMIT = 3 * 1024 * 1024;
class ReviewHttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function response(status: number, value: unknown) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }
function fail(status: number, code: string): never { throw new ReviewHttpError(status, code); }
function same(a: unknown, b: unknown) { return nativeCanonicalJson(a) === nativeCanonicalJson(b); }
function userInput<T>(read: () => T): T {
  try { return read(); } catch (error) { if (error instanceof ReviewHttpError) throw error; return fail(400, "MODULE_REVIEW_REQUEST_INVALID"); }
}
async function bytes(input: Request | Response, maximum: number) {
  if (!input.body || input.headers.has("content-encoding")) fail(502, "MODULE_REVIEW_RESPONSE_INVALID");
  const declared = input.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) fail(413, "MODULE_REVIEW_RESPONSE_TOO_LARGE");
  const reader = input.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ReviewHttpError(408, "MODULE_REVIEW_READ_TIMEOUT")), 10_000); });
  try { for (;;) { const item = await Promise.race([reader.read(), deadline]); if (item.done) break; size += item.value.byteLength; if (size > maximum) fail(413, "MODULE_REVIEW_RESPONSE_TOO_LARGE"); chunks.push(item.value); } }
  catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { clearTimeout(timer); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
function parsed(value: Uint8Array, maximum: number) { return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(value), { maximumBytes: maximum, maximumDepth: 40 }); }
function jsonHeader(input: Request | Response) { if (input.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") fail(415, "MODULE_REVIEW_JSON_REQUIRED"); }

export function createModuleReviewClient(input: {
  authenticator: WalletPrincipalAuthenticatorV1; backendBaseUrl: string; websiteToken: string; bffAssertionKeyV2: string;
  fetchBackend: typeof fetch; releaseIdentity?: unknown; engineReleaseIdentity?: unknown; now?: () => Date; nonce?: () => string;
}) {
  const base = new URL(input.backendBaseUrl);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) || base.username || base.password || base.search || base.hash) throw new Error("Module review backend URL is invalid.");
  if (input.websiteToken.length < 43 || input.websiteToken.length > 512 || /\s|\u0000/u.test(input.websiteToken)) throw new Error("Module review service token is invalid.");
  const assertionKey = requireWalletAdminBffAssertionKeyV2(input.bffAssertionKeyV2, input.websiteToken);
  return { async handle(request: Request, operation: Operation, id?: string): Promise<Response> {
    try {
      const mutation = ["plan", "manifest", "decision"].includes(operation);
      if (request.method !== (mutation ? "POST" : "GET")) fail(405, "METHOD_NOT_ALLOWED");
      const url = new URL(request.url);
      const allowedQuery = mutation ? [] : ["walletAddress", ...(operation === "list" ? ["cursor"] : [])];
      if (url.hash || [...url.searchParams.keys()].some((key) => !allowedQuery.includes(key)) || [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) fail(400, "MODULE_REVIEW_REQUEST_INVALID");
      if (operation !== "list" && !isReviewId(id)) fail(400, "MODULE_REVIEW_ID_INVALID");
      if (mutation) jsonHeader(request);
      const principal = await input.authenticator.authenticate(request);
      const bodyBytes = mutation ? await bytes(request, BROWSER_LIMIT) : null;
      const body = bodyBytes ? userInput(() => reviewRecord(parsed(bodyBytes, BROWSER_LIMIT))) : null;
      const rawWallet = mutation ? body?.walletAddress : url.searchParams.get("walletAddress");
      if (typeof rawWallet !== "string" || !isAddress(rawWallet) || BigInt(rawWallet) === 0n) fail(400, "wallet_address_invalid");
      const wallet = getAddress(rawWallet).toLowerCase() as `0x${string}`;
      if (!principal.wallets.some((linked) => linked.toLowerCase() === wallet)) fail(403, "wallet_not_linked");
      if (!isWebsiteAdminWallet(wallet)) fail(403, "admin_wallet_required");
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
      const call = async (path: string, method: "GET" | "POST" = "GET", payload?: unknown, maximum = 4 * 1024 * 1024) => {
        const target = new URL(path, base);
        const bodyBytes = payload === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload));
        const assertion = createWalletAdminBffAssertionV2({ method, requestTarget: `${target.pathname}${target.search}`, privyUserId: principal.privyUserId, walletAddress: wallet, issuedAt: (input.now?.() ?? new Date()).toISOString(), nonce: input.nonce?.() ?? randomBytes(16).toString("base64url"), bodyBytes, assertionKey });
        // The bounded reader requires unencoded bytes; Node fetch otherwise negotiates compression automatically.
        const result = await input.fetchBackend(target, { method, headers: { Accept: "application/json", "Accept-Encoding": "identity", Authorization: `Bearer ${input.websiteToken}`, "X-Programmable-Privy-User-Id": principal.privyUserId, "X-Programmable-Wallet-Address": wallet, ...assertion, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) }, body: payload === undefined ? undefined : bodyBytes, cache: "no-store", redirect: "error", signal });
        if (result.redirected) fail(502, "MODULE_REVIEW_RESPONSE_INVALID");
        jsonHeader(result);
        const raw = await bytes(result, result.ok ? maximum : 16_384);
        if (!result.ok) {
          const error = reviewRecord(parsed(raw, 16_384));
          const code = (error.error as { code?: unknown } | null)?.code;
          fail([400, 401, 403, 404, 408, 409, 413, 429, 503].includes(result.status) ? result.status : 502, typeof code === "string" && /^[A-Z_a-z0-9]{1,128}$/u.test(code) ? code : "MODULE_REVIEW_BACKEND_UNAVAILABLE");
        }
        return { status: result.status, raw, value: parsed(raw, maximum) };
      };
      const loadDetail = async (): Promise<{ detail: ReviewDetail; sourceRaw: Buffer }> => {
        const [detailResponse, sourceResponse] = await Promise.all([call(`${BACKEND_PATH}/${id}`), call(`${BACKEND_PATH}/${id}/source`, "GET", undefined, MODULE_TRANSPORT_LIMITS.requestBytes)]);
        const detail = reviewRecord(detailResponse.value);
        if (detailResponse.status !== 200 || sourceResponse.status !== 200 || detail.schemaVersion !== "programmable.modules.review-detail.v1") fail(502, "MODULE_REVIEW_RESPONSE_INVALID");
        const job = parseReviewJob(detail.job);
        if (job.subject.submissionId !== id) fail(502, "MODULE_REVIEW_SUBJECT_MISMATCH");
        const checked = validateModuleSubmissionRequest(sourceResponse.value);
        if (!checked.ok || checked.requestDigest !== job.subject.requestDigest || checked.request.descriptor.author.toLowerCase() !== job.subject.author) fail(502, "MODULE_REVIEW_SOURCE_MISMATCH");
        if (job.artifact && (job.artifact.packageId !== checked.packageId || job.artifact.familyId !== checked.familyId || job.artifact.rewardWallet !== checked.request.descriptor.rewardWallet.toLowerCase() || job.artifact.sourceManifestHash !== reviewDigest("programmable.modules.source-manifest.v1", checked.request.descriptor) || job.artifact.configurationSchemaHash !== reviewDigest("programmable.modules.configuration-schema.v1", checked.request.descriptor.configuration))) fail(502, "MODULE_REVIEW_SOURCE_MISMATCH");
        if (job.artifact?.schemaVersion === "programmable.modules.engine-build.v1") {
          if (job.plan?.schemaVersion !== "programmable.modules.engine-build-plan.v1") fail(502, "MODULE_REVIEW_BUILD_PROFILE_MISMATCH");
          verifyModuleEngineBuildArtifactV1(job.artifact, job.subject, job.plan, checked.request);
        }
        if (!Array.isArray(detail.decisions) || detail.decisions.length > 1000 || detail.decisions.some((decision) => !validateModuleReviewDecisionRecordV1(decision) || !same(decision.subject, job.subject))) fail(502, "MODULE_REVIEW_DECISION_INVALID");
        const attempts = detail.attempts ?? [];
        if (!Array.isArray(attempts) || attempts.length > 24) fail(502, "MODULE_REVIEW_ATTEMPTS_INVALID");
        return { detail: { schemaVersion: "programmable.modules.website-review-detail.v1", job, decisions: detail.decisions as ReviewDetail["decisions"], attempts: attempts.map((item) => parseReviewAttempt(item, job.subject)), source: { descriptor: checked.request.descriptor, packageId: checked.packageId, familyId: checked.familyId, files: checked.request.files.map((file) => ({ path: file.path, sha256: file.sha256, bytes: Buffer.from(file.bytes, "base64").byteLength })) } }, sourceRaw: sourceResponse.raw };
      };
      const validateManifest = (text: unknown, detail: ReviewDetail) => {
        if (typeof text !== "string" || Buffer.byteLength(text) > 2 * 1024 * 1024) fail(400, "MODULE_REVIEW_MANIFEST_REQUIRED");
        if (!detail.job.artifact) fail(409, "MODULE_REVIEW_BUILD_REQUIRED");
        if (detail.job.artifact.schemaVersion === "programmable.modules.engine-build.v1") {
          const raw = userInput(() => parsed(Buffer.from(text), 2 * 1024 * 1024));
          if (input.engineReleaseIdentity === null || input.engineReleaseIdentity === undefined) fail(409, "MODULE_REVIEW_HOST_RELEASE_UNAVAILABLE");
          // Bind the closed server identity before Engine publication or activation.
          // Validate it here so configuration failures stay local to Engine review.
          const release = bindModuleEngineReleaseIdentity(input.engineReleaseIdentity);
          const manifest = userInput(() => reviewRecord(reviewRecord(raw).manifest));
          const expected = userInput(() => createReviewedModuleEngineManifest({ job: detail.job, descriptor: detail.source.descriptor,
            release, definition: manifest.catalogDefinition as ModuleEngineCatalogDefinition,
            revision: manifest.revision as ModuleEngineRevisionDefinition }));
          if (!same(raw, expected)) fail(400, "MODULE_REVIEW_MANIFEST_BUILD_MISMATCH");
          return computeModuleEngineHostManifestHash(expected);
        }
        const release = input.releaseIdentity ?? configuredRelease;
        if (!release || typeof release !== "object" || typeof (release as { releaseDigest?: unknown }).releaseDigest !== "string") fail(409, "MODULE_REVIEW_HOST_RELEASE_UNAVAILABLE");
        const raw = userInput(() => parsed(Buffer.from(text), 2 * 1024 * 1024));
        const manifest = reviewRecord(reviewRecord(raw).manifest);
        const binding = reviewRecord(manifest.runtimeBinding);
        const nativeBinding = { familyId: binding.familyId, packageId: binding.packageId, factory: binding.factory, factoryCodeHash: binding.factoryCodeHash, moduleCodeHash: binding.moduleCodeHash, callbackGas: binding.callbackGas,
          ...(Object.hasOwn(binding, "feeEligibility") ? { feeEligibility: binding.feeEligibility } : {}) };
        const artifact = detail.job.artifact;
        if (nativeBinding.familyId !== artifact.familyId || nativeBinding.packageId !== artifact.packageId || nativeBinding.factoryCodeHash !== artifact.factory.runtimeCodeHash || nativeBinding.moduleCodeHash !== artifact.program.runtimeCodeHash || nativeBinding.callbackGas !== artifact.callbackGas) fail(400, "MODULE_REVIEW_MANIFEST_BUILD_MISMATCH");
        const expected = userInput(() => createModuleModeHostManifest({ release: release as ModuleModeHostReleaseIdentity, definition: manifest.catalogDefinition as ModuleModeCatalogDefinition, nativeBinding: nativeBinding as Parameters<typeof createModuleModeHostManifest>[0]["nativeBinding"], descriptor: detail.source.descriptor }));
        const plan = detail.job.plan;
        if (!plan || plan.configurationCodec !== "programmable.native-abi@1" || artifact.configurationCodec !== plan.configurationCodec || !same(plan.programAbi, artifact.programAbi) || !same(expected.manifest.configuration.abiMapping, plan.programAbi) || !same(expected.manifest.catalogDefinition.programAbi, plan.programAbi)) fail(400, "MODULE_REVIEW_MANIFEST_ABI_MISMATCH");
        if (!same(raw, expected) || unsupportedManagementCapabilities(expected.manifest.management).length) fail(400, "MODULE_REVIEW_MANIFEST_INVALID");
        return computeModuleModeHostManifestHash(expected);
      };
      if (operation === "list") {
        const cursor = url.searchParams.get("cursor"); if (cursor !== null && !isReviewId(cursor)) fail(400, "MODULE_REVIEW_CURSOR_INVALID");
        const upstream = await call(`${BACKEND_PATH}${cursor ? `?cursor=${cursor}` : ""}`, "GET", undefined, 262_144);
        const queue = reviewRecord(upstream.value, ["schemaVersion", "jobs", "nextCursor"]);
        if (upstream.status !== 200 || queue.schemaVersion !== "programmable.modules.review-queue.v1" || !Array.isArray(queue.jobs) || queue.jobs.length > 20 || (queue.nextCursor !== null && !isReviewId(queue.nextCursor))) fail(502, "MODULE_REVIEW_RESPONSE_INVALID");
        return response(200, { schemaVersion: "programmable.modules.website-review-queue.v1", jobs: queue.jobs.map(parseReviewQueueItem), nextCursor: queue.nextCursor });
      }
      const { detail, sourceRaw } = await loadDetail();
      if (operation === "detail") return response(200, detail);
      if (operation === "source") return new Response(Uint8Array.from(sourceRaw), { headers: { ...HEADERS, "Content-Disposition": `attachment; filename="module-${id}.json"` } });
      if (wallet === detail.job.subject.author) fail(403, "MODULE_REVIEW_SELF_DECISION_FORBIDDEN");
      if (operation === "plan") {
        userInput(() => reviewRecord(body, ["walletAddress", "expectedReviewRevision", "planJson"]));
        if (body!.expectedReviewRevision !== detail.job.reviewRevision) fail(409, "MODULE_REVIEW_REVISION_CONFLICT");
        if (typeof body!.planJson !== "string" || Buffer.byteLength(body!.planJson) > 262_144) fail(400, "MODULE_REVIEW_PLAN_INVALID");
        const planText = body!.planJson;
        const plan = userInput(() => parseReviewPlan(parsed(Buffer.from(planText as string), 262_144), detail.job.subject));
        const upstream = await call(`${BACKEND_PATH}/${id}/plan`, "POST", { expectedReviewRevision: detail.job.reviewRevision, plan });
        const receipt = reviewRecord(upstream.value);
        if (upstream.status !== 202 || receipt.schemaVersion !== "programmable.modules.review-plan-receipt.v1" || receipt.approved !== false || receipt.available !== false) fail(502, "MODULE_REVIEW_RESPONSE_INVALID");
        const next = parseReviewJob(receipt.job); if (!same(next.subject, detail.job.subject) || next.state !== "queued" || next.reviewRevision !== detail.job.reviewRevision + 1) fail(502, "MODULE_REVIEW_RESPONSE_INVALID");
        return response(202, receipt);
      }
      if (operation === "manifest") {
        userInput(() => reviewRecord(body, ["walletAddress", "expectedReviewRevision", "hostManifestJson"]));
        if (body!.expectedReviewRevision !== detail.job.reviewRevision) fail(409, "MODULE_REVIEW_REVISION_CONFLICT");
        return response(200, { schemaVersion: "programmable.modules.website-manifest-check.v1", submissionId: id, requestDigest: detail.job.subject.requestDigest, reviewRevision: detail.job.reviewRevision, artifactDigest: detail.job.artifact?.artifactDigest, hostManifestHash: validateManifest(body!.hostManifestJson, detail) });
      }
      userInput(() => reviewRecord(body, ["walletAddress", "command", "hostManifestJson"]));
      const command = body!.command;
      if (!validateModuleReviewDecisionCommandV1(command) || command.submissionId !== id || command.requestDigest !== detail.job.subject.requestDigest || command.expectedReviewRevision !== detail.job.reviewRevision) fail(409, "MODULE_REVIEW_REVISION_CONFLICT");
      if (command.outcome === "accept") {
        const artifact = detail.job.artifact;
        if (detail.job.state !== "built" || !artifact?.tests.allRequiredChecksPassed) fail(409, "MODULE_REVIEW_BUILD_REQUIRED");
        if (!artifact || command.artifactDigest !== artifact.artifactDigest || command.hostManifestHash !== validateManifest(body!.hostManifestJson, detail) || artifact.reviewRequired.some((area) => !command.acknowledgedReviewAreas.includes(area))) fail(400, "MODULE_REVIEW_MANIFEST_BUILD_MISMATCH");
      }
      if (command.outcome !== "accept" && body!.hostManifestJson !== null) fail(400, "MODULE_REVIEW_REQUEST_INVALID");
      const upstream = await call(`${BACKEND_PATH}/${id}/decisions`, "POST", command);
      const receipt = reviewRecord(upstream.value);
      if (upstream.status !== 201 || receipt.schemaVersion !== "programmable.modules.review-decision-receipt.v1" || !validateModuleReviewDecisionRecordV1(receipt.decision) || !same(receipt.decision.command, command) || receipt.decision.reviewerWallet !== wallet || !same(receipt.decision.subject, detail.job.subject)) fail(502, "MODULE_REVIEW_DECISION_INVALID");
      return response(201, receipt);
    } catch (error) {
      if (error instanceof ReviewHttpError || error instanceof WalletPrincipalAuthenticationErrorV1) return response(error.status, { error: { code: error.code } });
      return response(503, { error: { code: "MODULE_REVIEW_SERVICE_UNAVAILABLE" } });
    }
  } };
}

let client: ReturnType<typeof createModuleReviewClient> | undefined;
export async function moduleReviewRoute(request: Request, operation: Operation, id?: string) {
  try {
    client ??= createModuleReviewClient({ authenticator: createPrivyWalletPrincipalAuthenticatorV1(), backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL ?? "", websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN ?? "", bffAssertionKeyV2: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2 ?? "", fetchBackend: fetch, engineReleaseIdentity: configuredEngineReviewRelease });
    return await client.handle(request, operation, id);
  } catch { return response(503, { error: { code: "MODULE_REVIEW_SERVICE_UNAVAILABLE" } }); }
}
