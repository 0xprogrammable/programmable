#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, version as esbuildVersion } from "esbuild";
import { canonicalJson, sha256 } from "./data-pipeline/hosted-db-operator-core.mjs";
import { createBackupAndRestoreEvidence, MODULE_MODE_BACKUP_SCHEMAS, MODULE_MODE_RECOVERY_PROFILE,
  validateModuleRecoveryDatabaseEvidence } from "./data-pipeline/cutover-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execute = promisify(execFile);
const HASH = /^0x[0-9a-f]{64}$/u, COMMIT = /^[0-9a-f]{40}$/u;
const MAX_BLOB = 16 * 1024 * 1024, MAX_ARCHIVE_FILES = 32;
export class ModuleRecoveryError extends Error { constructor(code) { super(code); this.name = "ModuleRecoveryError"; } }
const fail = code => { throw new ModuleRecoveryError(`MODULE_RECOVERY_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
function record(value, keys, code) {
  requireValue(value && typeof value === "object" && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()), code);
  return value;
}
const absolute = value => typeof value === "string" && path.isAbsolute(value) && !value.includes("\0");

export function validateRecoveryConfig(value) {
  record(value, ["schemaVersion", "operationId", "repositoryCommit", "expectedSourceProjectRef", "sourceDatabaseUrlFile", "sourceCaFile",
    "restoreIsolationId", "restoreDatabaseUrlFile", "restoreCaFile", "blobFile", "blobEtag", "blobSha256", "blobBytes", "backendBaseUrl", "websiteTokenFile", "archiveFiles", "tools"], "CONFIG_INVALID");
  requireValue(value.schemaVersion === "programmable.module-mode-recovery-config.v1" && COMMIT.test(value.repositoryCommit)
    && /^[a-z0-9][a-z0-9._-]{7,63}$/u.test(value.operationId) && /^[a-z0-9]{20}$/u.test(value.expectedSourceProjectRef)
    && /^[a-z0-9][a-z0-9_-]{7,31}$/u.test(value.restoreIsolationId) && /^"[0-9a-f]{32}"$/u.test(value.blobEtag)
    && HASH.test(value.blobSha256) && Number.isSafeInteger(value.blobBytes) && value.blobBytes > 0 && value.blobBytes <= MAX_BLOB, "CONFIG_INVALID");
  for (const key of ["sourceDatabaseUrlFile", "sourceCaFile", "restoreDatabaseUrlFile", "restoreCaFile", "blobFile", "websiteTokenFile"]) {
    requireValue(absolute(value[key]), "INPUT_PATH_INVALID");
  }
  const base = new URL(value.backendBaseUrl);
  requireValue(base.protocol === "https:" && base.origin + "/" === base.href && !base.username && !base.password && !base.port, "BACKEND_ORIGIN_INVALID");
  requireValue(Array.isArray(value.archiveFiles) && value.archiveFiles.length > 0 && value.archiveFiles.length <= MAX_ARCHIVE_FILES, "ARCHIVE_INPUTS_MISSING");
  const kinds = new Set(), paths = new Set();
  for (const artifact of value.archiveFiles) {
    record(artifact, ["kind", "file", "bytes", "sha256"], "ARCHIVE_INPUT_INVALID");
    requireValue(["source", "compiler", "dependencies", "abi", "review", "deployment", "lifecycle", "operator"].includes(artifact.kind)
      && absolute(artifact.file) && !paths.has(artifact.file) && HASH.test(artifact.sha256)
      && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 512 * 1024 * 1024, "ARCHIVE_INPUT_INVALID");
    kinds.add(artifact.kind); paths.add(artifact.file);
  }
  requireValue(["source", "compiler", "dependencies", "abi", "review", "deployment", "lifecycle", "operator"].every(kind => kinds.has(kind)), "ARCHIVE_CLOSURE_INCOMPLETE");
  record(value.tools, ["pg_dump", "pg_restore", "psql"], "TOOLS_INVALID");
  for (const tool of Object.values(value.tools)) {
    record(tool, ["file", "bytes", "sha256"], "TOOLS_INVALID");
    requireValue(absolute(tool.file) && Number.isSafeInteger(tool.bytes) && tool.bytes > 0 && HASH.test(tool.sha256), "TOOLS_INVALID");
  }
  return value;
}

async function inputFile(filename, { secret = false, tool = false, maximum = 512 * 1024 * 1024 } = {}) {
  requireValue(absolute(filename), "INPUT_PATH_INVALID");
  let stat;
  try { stat = await lstat(filename); } catch { fail("INPUT_FILE_UNAVAILABLE"); }
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.uid === process.getuid() || (tool && stat.uid === 0))
    && stat.size > 0 && stat.size <= maximum && (stat.mode & 0o022) === 0
    && (!secret || [0o400, 0o600].includes(stat.mode & 0o777)), "INPUT_FILE_INVALID");
  requireValue(await realpath(filename) === filename, "INPUT_PATH_NOT_CANONICAL");
  return stat;
}
async function secretText(filename, maximum = 32768) {
  await inputFile(filename, { secret: true, maximum });
  return (await readFile(filename, "utf8")).trim();
}
async function fileCommitment(filename) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(filename, { highWaterMark: 1024 * 1024, flags: constants.O_RDONLY | constants.O_NOFOLLOW })) {
    hash.update(chunk); bytes += chunk.length;
  }
  return { sha256: `0x${hash.digest("hex")}`, bytes };
}
async function privateWrite(filename, value) {
  const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
  const directory = await open(path.dirname(filename), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
async function archiveCopy(source, destination) {
  const before = await inputFile(source), output = await open(destination, "wx", 0o600), hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(source, { highWaterMark: 1024 * 1024, flags: constants.O_RDONLY | constants.O_NOFOLLOW })) {
      await output.writeFile(chunk); hash.update(chunk); bytes += chunk.length;
    }
    await output.sync();
  } finally { await output.close(); }
  const after = await lstat(source), digest = `0x${hash.digest("hex")}`;
  requireValue(before.ino === after.ino && before.size === bytes && after.size === bytes && before.mtimeMs === after.mtimeMs
    && (await fileCommitment(source)).sha256 === digest, "ARCHIVE_CHANGED");
  return { file: path.basename(destination), bytes, sha256: digest };
}

let indexTools;
export async function loadRecoveryIndexTools() {
  if (!indexTools) indexTools = (async () => {
    const lock = JSON.parse(await readFile(path.join(ROOT, "package-lock.json"), "utf8"));
    requireValue(lock.packages["node_modules/esbuild"].version === esbuildVersion, "COMPILER_DIFFERS");
    const result = await build({ absWorkingDir: ROOT, stdin: { contents: `
      export { parseSnapshot, moduleModeSnapshots, snapshotLaunches } from './lib/server/robinhood-index/model';
      export { syncModuleModeIndex, syncRobinhoodIndex } from './lib/server/robinhood-index/sync';
      export { createModuleModeHttpCollector, moduleModeSource } from './lib/server/robinhood-index/module-source';
      export { robinhoodSource } from './lib/server/robinhood-index/source';
      export { parseStrictJson } from './lib/server/projection-target/canonical-json';`, resolveDir: ROOT },
      bundle: true, packages: "external", platform: "node", target: "node24", format: "cjs", write: false,
      tsconfig: path.join(ROOT, "tsconfig.json"), logLevel: "silent" });
    const bytes = Buffer.from(result.outputFiles[0].contents), loadedModule = { exports: {} };
    // Compile only the checked-out canonical repository sources, never an archived contribution.
    new Function("require", "module", "exports", bytes.toString("utf8"))(createRequire(import.meta.url), loadedModule, loadedModule.exports);
    return { ...loadedModule.exports, decoderBundleSha256: sha256(bytes),
      // The strict parser rejects duplicate keys and creates null-prototype records.
      // Clone only its validated values for the existing plain-record manifest helpers.
      parseStrictJson: (text, maximumBytes = MAX_BLOB) => structuredClone(loadedModule.exports.parseStrictJson(text, { maximumBytes })) };
  })();
  return indexTools;
}

function identity(row) {
  return `${row.sourceKind ?? "custom"}:${row.sourceAddress ?? row.routerAddress}:${row.sourceReleaseDigest ?? ""}:${row.launchId}:${row.transactionHash}:${row.blockHash}:${row.logIndex}`.toLowerCase();
}
function parityRow(row, expected) {
  // The current verifier may issue a newer finality digest; metadata is optional for the old Custom lane.
  const body = { ...row };
  delete body.verificationDigest; delete body.launchedAt;
  if (!row.sourceKind) { delete body.name; delete body.symbol; delete body.decimals; }
  if (expected.sourceKind === "module-engine-v1" && expected.primaryMarket === null) {
    for (const key of ["primaryMarket", "poolId", "poolManager", "hookAddress"]) delete body[key];
  }
  return canonicalJson(body);
}

export async function replayRecoveryIndex(snapshot, { tools, collector, customSource, now = Date.now }) {
  requireValue(snapshot && typeof snapshot === "object", "INDEX_BOOTSTRAP_UNAVAILABLE");
  tools.parseSnapshot(snapshot);
  const lanes = tools.moduleModeSnapshots(snapshot);
  requireValue(snapshot.cursor && lanes.length > 0 && lanes.every(lane => lane.cursor), "INDEX_BOOTSTRAP_UNAVAILABLE");
  const inventory = await collector.listAuthorizedSources();
  requireValue(inventory.unavailableSources.length === 0, "SOURCE_INVENTORY_UNAVAILABLE");
  requireValue(lanes.length === inventory.releases.length, "SOURCE_INVENTORY_DIFFERS");
  let restored = structuredClone(snapshot), version = 0, verifiedBlocks = 0;
  const started = now(), observations = [];
  const store = { read: async () => ({ snapshot: structuredClone(restored), etag: `recovery-${version}` }),
    write: async (next, etag) => { requireValue(etag === `recovery-${version}`, "LOCAL_CAS_CONFLICT"); restored = tools.parseSnapshot(structuredClone(next)); version++; } };
  const sources = [{ lane: snapshot, source: customSource, kind: "custom", releaseDigest: null }];
  for (const lane of lanes) {
    const release = inventory.releases.find(value => value.releaseDigest.toLowerCase() === lane.releaseDigest.toLowerCase());
    requireValue(release, "SOURCE_RELEASE_UNAVAILABLE");
    sources.push({ lane, source: await tools.moduleModeSource(release, collector), kind: lane.sourceKind, releaseDigest: release.releaseDigest, release });
  }
  for (const { lane, source, kind, releaseDigest, release } of sources) {
    requireValue(BigInt(source.finalized.number) >= BigInt(lane.finalizedBlock), "FINALITY_BEHIND_CUTOFF");
    const cutoff = await source.block(BigInt(lane.finalizedBlock));
    const previous = [...lane.items, ...(lane.pending?.items ?? [])];
    for (const blockNumber of new Set(previous.map(row => row.blockNumber))) {
      requireValue(++verifiedBlocks <= 256 && now() - started < 300000, "REPLAY_BUDGET_EXCEEDED");
      const canonical = await source.block(BigInt(blockNumber));
      const actual = await source.launches(BigInt(blockNumber), BigInt(blockNumber), []);
      for (const row of previous.filter(row => row.blockNumber === blockNumber)) {
        requireValue(row.blockHash.toLowerCase() === canonical.hash.toLowerCase(), "CANONICAL_HISTORY_CHANGED");
        const found = actual.find(value => identity(value) === identity(row));
        requireValue(found && parityRow(found, row) === parityRow(row, row), "LAUNCH_PARITY_UNPROVEN");
      }
    }
    const replaySource = { ...source, finalized: cutoff };
    const outcome = kind === "custom" ? await tools.syncRobinhoodIndex(replaySource, store, { now, maxRanges: 48 })
      : await tools.syncModuleModeIndex(replaySource, store, { now, maxRanges: 48 });
    requireValue(outcome.status === "ready" && !outcome.rewound, "REPLAY_INCOMPLETE");
    observations.push({ sourceKind: kind, sourceAddress: source.sourceAddress ?? source.routerAddress, releaseDigest,
      ...(release ? { release } : { routerBinding: source.binding }),
      sourceStartBlock: source.startBlock.toString(), cursor: lane.cursor, cutoff, rows: previous.length,
      identitiesSha256: sha256(canonicalJson(previous.map(identity).sort())), finalityPolicy: kind === "custom" ? "existing-canonical-router-finality" : "robinhood-ethereum-finalized-v1",
      replay: outcome });
  }
  const after = await collector.listAuthorizedSources();
  requireValue(canonicalJson(after) === canonicalJson(inventory), "SOURCE_INVENTORY_CHANGED");
  return { snapshot: restored, observations, verifiedBlocks, elapsedMs: now() - started, decoderBundleSha256: tools.decoderBundleSha256 };
}

export async function captureModuleRecovery(config, outputDirectory, confirmation) {
  validateRecoveryConfig(config);
  requireValue(confirmation === `RESTORE ONLY programmable_restore_${config.restoreIsolationId}`, "LOCAL_RESTORE_CONFIRMATION_REQUIRED");
  requireValue(absolute(outputDirectory), "OUTPUT_PATH_INVALID");
  const parent = await lstat(path.dirname(outputDirectory));
  requireValue(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o022) === 0
    && await realpath(path.dirname(outputDirectory)) === path.dirname(outputDirectory), "OUTPUT_PARENT_INVALID");
  const head = (await execute("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
  requireValue(head === config.repositoryCommit, "OPERATOR_COMMIT_DIFFERS");
  requireValue((await execute("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: ROOT })).stdout === "", "OPERATOR_CHECKOUT_NOT_CLEAN");
  const sourceDatabaseUrl = await secretText(config.sourceDatabaseUrlFile), sslCaPem = await secretText(config.sourceCaFile);
  const restoreDatabaseUrl = await secretText(config.restoreDatabaseUrlFile), restoreSslCaPem = await secretText(config.restoreCaFile);
  const websiteToken = await secretText(config.websiteTokenFile, 1024), tools = await loadRecoveryIndexTools();
  await inputFile(config.blobFile, { maximum: MAX_BLOB });
  const blobBytes = await readFile(config.blobFile), parsedBlob = tools.parseStrictJson(blobBytes.toString("utf8"));
  requireValue(parsedBlob?.cursor, "INDEX_BOOTSTRAP_UNAVAILABLE");
  const blob = tools.parseSnapshot(parsedBlob);
  requireValue(blobBytes.length === config.blobBytes && sha256(blobBytes) === config.blobSha256, "INDEX_INPUT_DIFFERS");
  requireValue(blob.cursor && tools.moduleModeSnapshots(blob).length > 0, "INDEX_BOOTSTRAP_UNAVAILABLE");
  let archiveBytes = 0;
  for (const artifact of config.archiveFiles) {
    archiveBytes += (await inputFile(artifact.file)).size;
    requireValue(canonicalJson(await fileCommitment(artifact.file)) === canonicalJson({ bytes: artifact.bytes, sha256: artifact.sha256 }), "ARCHIVE_INPUT_DIFFERS");
  }
  requireValue(archiveBytes <= 2 * 1024 * 1024 * 1024, "ARCHIVE_BUDGET_EXCEEDED");
  for (const tool of Object.values(config.tools)) {
    await inputFile(tool.file, { tool: true, maximum: 32 * 1024 * 1024 });
    requireValue(canonicalJson(await fileCommitment(tool.file)) === canonicalJson({ bytes: tool.bytes, sha256: tool.sha256 }), "POSTGRES_TOOL_DIFFERS");
  }
  await mkdir(outputDirectory, { mode: 0o700 });
  await privateWrite(path.join(outputDirectory, "attempt.json"), canonicalJson({ schemaVersion: MODULE_MODE_RECOVERY_PROFILE,
    operationId: config.operationId, repositoryCommit: head, sourceProjectRef: config.expectedSourceProjectRef,
    restoreIsolationId: config.restoreIsolationId, startedAt: new Date().toISOString(), productionRestoreAllowed: false }) + "\n");
  try {
    const collector = tools.createModuleModeHttpCollector({ backendBaseUrl: config.backendBaseUrl, websiteToken, fetchBackend: fetch });
    const customSource = await tools.robinhoodSource();
    const replay = await replayRecoveryIndex(blob, { tools, collector, customSource });
    const archiveFiles = [];
    for (let i = 0; i < config.archiveFiles.length; i++) {
      const copied = await archiveCopy(config.archiveFiles[i].file, path.join(outputDirectory, `artifact-${String(i).padStart(2, "0")}.bin`));
      requireValue(copied.sha256 === config.archiveFiles[i].sha256 && copied.bytes === config.archiveFiles[i].bytes, "ARCHIVE_INPUT_CHANGED");
      archiveFiles.push({ kind: config.archiveFiles[i].kind, ...copied });
    }
    await privateWrite(path.join(outputDirectory, "index-original.json"), blobBytes);
    const indexRestoredBytes = Buffer.from(canonicalJson(replay.snapshot) + "\n");
    await privateWrite(path.join(outputDirectory, "index-restored.json"), indexRestoredBytes);
    const result = await createBackupAndRestoreEvidence({ profile: MODULE_MODE_RECOVERY_PROFILE, schemas: MODULE_MODE_BACKUP_SCHEMAS,
      operationId: config.operationId, repositoryCommit: head, expectedProjectRef: config.expectedSourceProjectRef,
      allowedSourceUsernames: ["postgres", "cli_login_postgres"],
      sourceDatabaseUrl, sslCaPem, restoreDatabaseUrl, restoreIsolationId: config.restoreIsolationId, restoreSslCaPem,
      backupPath: path.join(outputDirectory, "database.dump"), evidencePath: path.join(outputDirectory, "database-evidence.json"),
      pgDumpBinary: config.tools.pg_dump.file, pgRestoreBinary: config.tools.pg_restore.file, psqlBinary: config.tools.psql.file,
      toolCommitments: Object.fromEntries(Object.entries(config.tools).map(([key, value]) => [key, { bytes: value.bytes, sha256: value.sha256 }])) });
    const database = validateModuleRecoveryDatabaseEvidence(result.evidence);
    requireValue((await fileCommitment(config.blobFile)).sha256 === sha256(blobBytes), "INDEX_INPUT_CHANGED");
    requireValue((await execute("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim() === head
      && (await execute("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: ROOT })).stdout === "", "OPERATOR_CHANGED");
    const manifest = { schemaVersion: "programmable.module-mode-recovery-manifest.v1", operationId: config.operationId, repositoryCommit: head,
      capturedAt: new Date().toISOString(), status: "isolated-restore-and-canonical-replay-verified", database: {
        file: "database.dump", ...result.evidence.backup, evidenceFile: "database-evidence.json",
        evidenceSha256: (await fileCommitment(path.join(outputDirectory, "database-evidence.json"))).sha256,
        schemas: MODULE_MODE_BACKUP_SCHEMAS, sourceManifestSha256: database.source.manifestSha256,
        restoredManifestSha256: database.restored.manifestSha256, tableCount: database.source.tableCount,
        rowCount: database.source.rowCount, tables: database.source.tables, sourceCaptureWindow: database.sourceCaptureWindow,
      }, index: { origin: "operator-provided-exact-blob-file", path: "website-index/robinhood/launches-v1.json", etag: config.blobEtag,
        file: "index-original.json", bytes: blobBytes.length, sha256: sha256(blobBytes), restoredFile: "index-restored.json",
        restoredSha256: sha256(indexRestoredBytes), decoderBundleSha256: replay.decoderBundleSha256, sources: replay.observations },
      archiveFiles, postgresTools: Object.fromEntries(Object.entries(config.tools).map(([key, value]) => [key, { bytes: value.bytes, sha256: value.sha256 }])),
      measurements: { isolatedDatabaseRestoreMs: database.restoreElapsedMs, indexReplayMs: replay.elapsedMs,
        rto: { status: "unavailable", reason: "END_TO_END_PROVIDER_RECOVERY_NOT_EXERCISED" },
        rpo: { status: "unavailable", reason: "INDEPENDENT_COMMIT_CUTOFF_AND_ARCHIVE_COPIES_NOT_ATTESTED" } },
      assetClaims: { status: "unavailable", reason: "ONCHAIN_LEDGER_BALANCES_ARE_NOT_IN_THESE_STORES" },
      independentArchiveCopies: "unavailable", productionActivationAuthorized: false, productionRestorePerformed: false,
      revocationRecovery: "exact captured auth rows; reconcile later revocations before any production restore; local runtime roles stay NOLOGIN" };
    await privateWrite(path.join(outputDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return { status: manifest.status, manifestSha256: (await fileCommitment(path.join(outputDirectory, "manifest.json"))).sha256 };
  } catch (error) {
    await privateWrite(path.join(outputDirectory, "failed.json"), canonicalJson({ schemaVersion: MODULE_MODE_RECOVERY_PROFILE,
      operationId: config.operationId, status: "failed-no-activation", retry: "inspect preserved artifacts and local target; never restore production",
      code: error instanceof ModuleRecoveryError ? error.message : "MODULE_RECOVERY_FAILED" }) + "\n").catch(() => {});
    throw error;
  }
}

export async function verifyRecoveryCapsule(directory, expectedManifestSha256) {
  requireValue(absolute(directory) && HASH.test(expectedManifestSha256), "VERIFY_INPUT_INVALID");
  const stat = await lstat(directory);
  requireValue(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700
    && await realpath(directory) === directory, "CAPSULE_DIRECTORY_INVALID");
  const tools = await loadRecoveryIndexTools();
  const manifestBytes = Buffer.from(await secretText(path.join(directory, "manifest.json"), 1024 * 1024));
  requireValue((await fileCommitment(path.join(directory, "manifest.json"))).sha256 === expectedManifestSha256, "MANIFEST_DIGEST_DIFFERS");
  const manifest = tools.parseStrictJson(manifestBytes.toString("utf8"));
  requireValue(manifest?.schemaVersion === "programmable.module-mode-recovery-manifest.v1"
    && manifest.status === "isolated-restore-and-canonical-replay-verified" && manifest.productionRestorePerformed === false
    && manifest.productionActivationAuthorized === false && manifest.database?.file === "database.dump"
    && manifest.database.evidenceFile === "database-evidence.json" && manifest.index?.file === "index-original.json"
    && manifest.index.restoredFile === "index-restored.json" && manifest.index.decoderBundleSha256 === tools.decoderBundleSha256
    && Array.isArray(manifest.archiveFiles) && manifest.archiveFiles.length <= MAX_ARCHIVE_FILES, "MANIFEST_INVALID");
  const files = [{ file: "database.dump", sha256: manifest.database.sha256, bytes: manifest.database.bytes },
    { file: "database-evidence.json", sha256: manifest.database.evidenceSha256 },
    { file: "index-original.json", sha256: manifest.index.sha256, bytes: manifest.index.bytes },
    { file: "index-restored.json", sha256: manifest.index.restoredSha256 }, ...manifest.archiveFiles];
  const seen = new Set();
  for (const file of files) {
    requireValue(typeof file.file === "string" && /^(?:database\.dump|database-evidence\.json|index-(?:original|restored)\.json|artifact-[0-9]{2}\.bin)$/u.test(file.file)
      && !seen.has(file.file) && HASH.test(file.sha256), "CAPSULE_FILE_INVALID");
    seen.add(file.file);
    await inputFile(path.join(directory, file.file), { secret: true, maximum: 16 * 1024 * 1024 * 1024 });
    const actual = await fileCommitment(path.join(directory, file.file));
    requireValue(actual.sha256 === file.sha256 && (file.bytes === undefined || actual.bytes === file.bytes), "CAPSULE_FILE_DIFFERS");
  }
  const database = validateModuleRecoveryDatabaseEvidence(tools.parseStrictJson(await secretText(path.join(directory, "database-evidence.json"), 4 * 1024 * 1024)));
  requireValue(canonicalJson(database.source.tables) === canonicalJson(manifest.database.tables), "DATABASE_SUMMARY_DIFFERS");
  for (const file of ["index-original.json", "index-restored.json"]) tools.parseSnapshot(tools.parseStrictJson(await secretText(path.join(directory, file), MAX_BLOB)));
  return { status: "local-capsule-integrity-verified", manifestSha256: expectedManifestSha256, productionActivationAuthorized: false };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    return { usage: "node scripts/module-mode-recovery-v1.mjs capture --config-file <absolute-private-json> --output-directory <new-absolute-directory> --confirm-isolated-target 'RESTORE ONLY programmable_restore_<isolationId>'",
      verify: "node scripts/module-mode-recovery-v1.mjs verify --directory <absolute-capsule> --expected-manifest-sha256 <capture-output-digest>",
      effects: "Read exact configured source using pg_dump. Restore only to a verified empty dedicated local cluster. Read canonical index sources. Write private local evidence. No source database or Blob writes." };
  }
  if (args.length === 5 && args[0] === "verify" && args[1] === "--directory" && args[3] === "--expected-manifest-sha256") {
    return verifyRecoveryCapsule(args[2], args[4]);
  }
  requireValue(args.length === 7 && args[0] === "capture" && args[1] === "--config-file"
    && args[3] === "--output-directory" && args[5] === "--confirm-isolated-target", "ARGUMENTS_INVALID");
  const tools = await loadRecoveryIndexTools();
  const config = validateRecoveryConfig(tools.parseStrictJson(await secretText(args[2], 65536)));
  return captureModuleRecovery(config, args[4], args[6]);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => process.stdout.write(JSON.stringify(result) + "\n")).catch(error => {
    process.stderr.write((error instanceof ModuleRecoveryError ? error.message : "MODULE_RECOVERY_FAILED") + "\n"); process.exitCode = 1;
  });
}
