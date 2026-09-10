import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { isReviewId, parseReviewJob, parseReviewSourceCorrection, reviewDigest, reviewRecord, type ReviewDetail } from "../../lib/module-mode/review-contract";
import { nativeCanonicalJson } from "../../lib/module-mode/native-catalog";
import { bindModuleSourceCorrectionReceipt, MODULE_SOURCE_CORRECTION_LIMIT, parseModuleSourceCorrectionCommand, parseModuleSourceCorrectionReceipt, type ModuleSourceCorrectionCommand, type ModuleSourceCorrectionReceipt } from "../../lib/server/module-mode/review-source-correction";
import { MODULE_TRANSPORT_LIMITS, validateModuleSubmissionRequest, type ModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";
import { exactJson, ModulePublicationError, need, readOperatorSession, REVIEW_ORIGIN, same, type OperatorSession } from "./review";

interface Submission { detail: ReviewDetail; source: ModuleSubmissionRequest; sourceBytes: Uint8Array }
async function fileJson(file: string, maximum: number, privateFile = false): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= maximum
      && (!privateFile || (info.uid === process.getuid?.() && (info.mode & 0o077) === 0)), "Correction input must be a bounded regular file with the required permissions");
    return exactJson(await handle.readFile(), maximum);
  } finally { await handle.close(); }
}
async function responseBytes(response: Response, maximum: number): Promise<Uint8Array> {
  need(!response.redirected && response.body && !response.headers.has("content-encoding")
    && /^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? ""), "Correction endpoint returned an invalid response");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength; need(size <= maximum, "Correction response exceeds its byte limit"); chunks.push(item.value);
    }
    return Buffer.concat(chunks);
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
function correctionClient(session: OperatorSession, fetchImpl: typeof fetch) {
  const request = async (submissionId: string, suffix: string, payload?: unknown, maximum = 4 * 1024 * 1024) => {
    need(isReviewId(submissionId), "Invalid correction submission identifier");
    const url = new URL(`${REVIEW_ORIGIN}/api/admin/modules/${submissionId}${suffix}`);
    if (payload === undefined) url.searchParams.set("walletAddress", session.walletAddress);
    let response: Response;
    try {
      response = await fetchImpl(url, { method: payload === undefined ? "GET" : "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json", "Accept-Encoding": "identity", Authorization: `Bearer ${session.accessToken}`,
          ...(session.identityToken ? { "X-Privy-Identity-Token": session.identityToken } : {}), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(payload === undefined ? {} : { body: JSON.stringify({ walletAddress: session.walletAddress, command: payload }) }) });
    } catch { throw new ModulePublicationError("Correction request did not return a confirmed result. Keep the original idempotency key and reconcile the existing output directory."); }
    const raw = await responseBytes(response, response.ok ? maximum : 16_384);
    const value = exactJson(raw, response.ok ? maximum : 16_384);
    if (!response.ok) {
      const error = reviewRecord(value).error;
      const code = error && typeof error === "object" && !Array.isArray(error) ? (error as { code?: unknown }).code : null;
      if (response.status === 404 && code === "MODULE_CORRECTION_NOT_FOUND" && suffix.startsWith("/corrections?")) return null;
      throw new ModulePublicationError(`Correction endpoint rejected the request (${response.status}${typeof code === "string" && /^[A-Z_a-z0-9]{1,128}$/u.test(code) ? `, ${code}` : ""}).`);
    }
    return { value, raw, status: response.status };
  };
  return {
    async read(submissionId: string): Promise<Submission> {
      const [detailResponse, sourceResponse] = await Promise.all([request(submissionId, ""), request(submissionId, "/source", undefined, MODULE_TRANSPORT_LIMITS.requestBytes)]);
      need(detailResponse?.status === 200 && sourceResponse?.status === 200, "Correction source read is unavailable");
      const raw = reviewRecord(detailResponse.value);
      need(raw.schemaVersion === "programmable.modules.website-review-detail.v1", "Correction detail format differs");
      const job = parseReviewJob(raw.job);
      const checked = validateModuleSubmissionRequest(sourceResponse.value);
      need(checked.ok && job.subject.submissionId === submissionId && checked.requestDigest === job.subject.requestDigest
        && checked.request.descriptor.author.toLowerCase() === job.subject.author, "Correction source does not bind its original author");
      const metadata = reviewRecord(raw.source);
      same(metadata.descriptor, checked.request.descriptor, "Correction source descriptor");
      need(metadata.packageId === checked.packageId && metadata.familyId === checked.familyId, "Correction source identity differs");
      const sourceCorrection = raw.sourceCorrection === undefined || raw.sourceCorrection === null ? null : parseReviewSourceCorrection(raw.sourceCorrection);
      const detail = { ...raw, job, sourceCorrection } as unknown as ReviewDetail;
      const closing = await request(submissionId, "");
      need(closing?.status === 200, "Closing correction detail read is unavailable");
      const fresh = reviewRecord(closing.value);
      same(fresh.job, raw.job, "Concurrent correction review revision");
      same(fresh.sourceCorrection ?? null, sourceCorrection, "Concurrent source correction");
      return { detail, source: checked.request, sourceBytes: sourceResponse.raw };
    },
    async find(submissionId: string, key: string): Promise<ModuleSourceCorrectionReceipt | null> {
      const result = await request(submissionId, `/corrections?idempotencyKey=${encodeURIComponent(key)}`, undefined, 16_384);
      if (!result) return null;
      need(result.status === 200, "Correction lookup status differs");
      return parseModuleSourceCorrectionReceipt(result.value);
    },
    async submit(submissionId: string, command: ModuleSourceCorrectionCommand): Promise<ModuleSourceCorrectionReceipt> {
      const result = await request(submissionId, "/corrections", command, 16_384);
      need(result && [200, 201].includes(result.status), "Correction creation status differs");
      return parseModuleSourceCorrectionReceipt(result.value);
    },
  };
}
function verifySource(parent: Submission, corrected: Submission, command: ModuleSourceCorrectionCommand, receipt: ModuleSourceCorrectionReceipt) {
  const record = receipt.sourceCorrection;
  same(corrected.detail.sourceCorrection, record, "Stored correction provenance");
  need(corrected.detail.job.subject.submissionId === record.submissionId && corrected.detail.job.subject.requestDigest === record.requestDigest
    && corrected.detail.job.subject.author === record.author && corrected.detail.job.subject.principalId === record.principalId
    && corrected.detail.source.packageId === record.packageId && corrected.detail.source.familyId === record.familyId
    && corrected.source.supersedesSubmissionId === record.parentSubmissionId, "Corrected submission identity differs");
  const expectedFiles = new Map(parent.source.files.map(file => [file.path, { path: file.path, sha256: file.sha256 }]));
  for (const change of command.files) expectedFiles.set(change.path, { path: change.path, sha256: change.sha256 });
  const pinned = [...expectedFiles.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const expectedDescriptor = { ...parent.source.descriptor, version: command.version, source: { files: pinned } };
  const correctedDescriptor = { ...corrected.source.descriptor, source: { ...corrected.source.descriptor.source,
    files: [...corrected.source.descriptor.source.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) } };
  same(correctedDescriptor, expectedDescriptor, "Corrected descriptor and original attribution");
  const changed = new Set(command.files.map(file => file.path));
  const files = new Map(corrected.source.files.map(file => [file.path, file]));
  for (const file of parent.source.files) if (!changed.has(file.path)) same(files.get(file.path), file, "Unchanged source bytes");
}

/** Uses the authenticated admin BFF only. A correction does not build, approve, sign or publish. */
export async function runSourceCorrection(options: Record<string, string>, repositoryRoot: string, fetchImpl: typeof fetch = fetch) {
  const command = parseModuleSourceCorrectionCommand(await fileJson(options["correction-file"], MODULE_SOURCE_CORRECTION_LIMIT));
  need(isReviewId(options.submission), "Invalid correction submission identifier");
  const session = await readOperatorSession(options["session-file"]);
  const output = path.resolve(options.output);
  const physicalParent = await realpath(path.dirname(output));
  const parentStat = await lstat(physicalParent);
  need(physicalParent === path.dirname(output) && parentStat.isDirectory() && parentStat.uid === process.getuid?.() && (parentStat.mode & 0o077) === 0, "Output parent must be a private owner-only real directory");
  need(output !== path.resolve(repositoryRoot) && !output.startsWith(path.resolve(repositoryRoot) + path.sep), "Write correction evidence outside the source checkout");
  const intent = { schemaVersion: "programmable.modules.source-correction-intent.v1", parentSubmissionId: options.submission,
    walletAddress: session.walletAddress.toLowerCase(), commandDigest: reviewDigest("programmable.modules.source-correction-command.v1", command) };
  let recovering = false;
  try { await mkdir(output, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const info = await lstat(output);
    need(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0, "Correction output must remain a private real directory");
    same(await fileJson(path.join(output, "intent.json"), 4096, true), intent, "Existing correction intent");
    same(await fileJson(path.join(output, "command.json"), MODULE_SOURCE_CORRECTION_LIMIT, true), command, "Existing correction command");
    recovering = true;
  }
  const write = (name: string, value: unknown) => writeFile(path.join(output, name), `${nativeCanonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
  if (!recovering) { await write("intent.json", intent); await write("command.json", command); }
  const client = correctionClient(session, fetchImpl);
  const parent = await client.read(options.submission);
  let receipt = await client.find(options.submission, command.idempotencyKey);
  if (!receipt) {
    need(!recovering, "No committed correction is visible yet. Reconcile this output directory again; keep its command and idempotency key unchanged.");
    need(parent.detail.sourceCorrection == null && parent.detail.job.subject.author !== session.walletAddress.toLowerCase(), "Correction requires an independent administrator and an original author submission");
    need(["awaiting_plan", "build_failed", "changes_requested", "built"].includes(parent.detail.job.state), "The parent submission must be unapproved and have no active build");
    need(parent.detail.job.reviewRevision === command.expectedReviewRevision && parent.detail.job.subject.requestDigest === command.requestDigest, "Correction parent revision changed; prepare a new reviewed command before sending");
    const originals = new Map(parent.source.files.map(file => [file.path, file.sha256]));
    for (const change of command.files) need(change.expectedSha256 === null ? !originals.has(change.path) : originals.get(change.path) === change.expectedSha256, "Correction source hash differs from the current parent");
    await write("request.pending.json", intent);
    try { receipt = await client.submit(options.submission, command); }
    catch (error) {
      receipt = await client.find(options.submission, command.idempotencyKey);
      if (!receipt) throw error;
    }
  }
  bindModuleSourceCorrectionReceipt(receipt, parent.detail, session.walletAddress.toLowerCase(), command);
  const corrected = await client.read(receipt.sourceCorrection.submissionId);
  verifySource(parent, corrected, command, receipt);
  const completion = { schemaVersion: "programmable.modules.source-correction-complete.v1", sourceCorrection: receipt.sourceCorrection,
    sourceBytesVerified: true, approved: false, available: false };
  for (const [name, value] of [["receipt.json", receipt], ["corrected-source.json", corrected.source], ["correction.complete.json", completion]] as const) {
    try { await write(name, value); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const previous = await fileJson(path.join(output, name), MODULE_TRANSPORT_LIMITS.requestBytes, true);
      if (name === "receipt.json") same(parseModuleSourceCorrectionReceipt(previous).sourceCorrection, receipt.sourceCorrection, "Existing correction receipt");
      else same(previous, value, "Existing correction evidence");
    }
  }
  console.log(JSON.stringify({ status: "source-correction-recorded", output, submissionId: receipt.sourceCorrection.submissionId,
    parentSubmissionId: options.submission, version: receipt.sourceCorrection.version, author: receipt.sourceCorrection.author,
    rewardWallet: receipt.sourceCorrection.rewardWallet, approved: false, available: false }));
}
