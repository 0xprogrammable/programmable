import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { canonicalJson, sha256 } from "../data-pipeline/hosted-db-operator-core.mjs";
import { BACKUP_SCHEMAS, MODULE_MODE_BACKUP_SCHEMAS, MODULE_MODE_RECOVERY_PROFILE,
  captureDatabaseManifest, createBackupAndRestoreEvidence, inspectModuleRestore, moduleRestoreTlsOptions, validateModuleRecoveryDatabaseEvidence } from "../data-pipeline/cutover-credentials.mjs";
import { loadRecoveryIndexTools, main, replayRecoveryIndex, validateRecoveryConfig, verifyRecoveryCapsule } from "../module-mode-recovery-v1.mjs";

const TEST_LEAF = "-----BEGIN CERTIFICATE-----\nMIIDKDCCAhCgAwIBAgIUCTC5m2grfu2ukN7oMfeSSrbLUS0wDQYJKoZIhvcNAQEL\nBQAwJDEiMCAGA1UEAwwZTW9kdWxlIHJlY292ZXJ5IHRlc3QgbGVhZjAeFw0yNjA5\nMDcxNTU1MjZaFw0zNjA5MDQxNTU1MjZaMCQxIjAgBgNVBAMMGU1vZHVsZSByZWNv\ndmVyeSB0ZXN0IGxlYWYwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDA\ngf7+/UGt5WX+Sjpyx6yx1kLioQHE+/c1baN46rclPStAPew6zbEzXYAhL8lP+BPo\n6vStcGME0ciitJJ9LSWUo5PRMtkLkqYqXmuW01fODDRwp3IzUYckaj6kAy0bFFpO\nO2nG6r/5h+EgAHUfbrookP8PdVtm1n6SKqFtPM5gSsOCkNg8XiTh88fzdAOoSCpV\nYGcAVcJDFpYoaUM1u4zO29GExzvpKKTKvtmBLbWku+OtCj6V/oqfFIlm8insaGzz\nrcvHgAn6S03elAH5vGQbqBrg8bdBaZmIWoByPGfjaifk9LgIb1JJptiCGmHmp4BL\nv39EehQukmZVdrfjETbDAgMBAAGjUjBQMAwGA1UdEwEB/wQCMAAwIQYDVR0RBBow\nGIcEfwAAAYcQAAAAAAAAAAAAAAAAAAAAATAdBgNVHQ4EFgQUEl5h2CfLVz4PRL9d\nq4g16Vv9JBQwDQYJKoZIhvcNAQELBQADggEBAKvEF/vbj7jOqvhGeA5OJyc17M+R\n4W6RdPwhhjs3jmLreZlgboMPnGOx5FuJLPxGMUF9lUufmE7MWYICkorOAzJ9jVxK\nniJfxp5FXkQqKPn5IV4FgfJ+qc5BFcpwpCSKNEaGhiyUZK9Hr+TlaSUFD9Qw4Yyg\nFLBwuc4DyRQH0O9VcFNqUWeu7r4ox0dBHgSgUxJ3DJH4dJGANuyE6v7bhOEkwWsX\n8mizMmwFVcusIvkcA7/qVFxBsGT731Ut3SfkjOm9QhOB4gsw0BUAceIX8icYPExL\nIxGkXgtCPU7F1yS1cxga7n+/ZrnxVsIHCRT9pM9e9aya0kINW0126PUnZlk=\n-----END CERTIFICATE-----\n";
const LOCAL_BINDING = { dataDirectory: "/private/fixture/data", postmasterPid: 1234, systemIdentifier: "7682821037906232164",
  postgres: { file: "/private/fixture/bin/postgres", bytes: 10, sha256: "0x"+"a".repeat(64) },
  pgControlData: { file: "/private/fixture/bin/pg_controldata", bytes: 11, sha256: "0x"+"b".repeat(64) } };
const PROFILE = { schemas: MODULE_MODE_BACKUP_SCHEMAS, profile: MODULE_MODE_RECOVERY_PROFILE };
const API = "programmable_custom_launch_api_v1";
const REQUIRED = ["principals", "wallet_bindings", "api_credentials", "api_credential_scopes", "api_scopes",
  "module_submission_keys_v1", "module_request_budgets_v1", "module_review_jobs_v1", "module_review_attempts_v1", "module_review_decisions_v1"];
const h = n => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const pending = rows => { const promise = Promise.resolve(rows); promise.simple = () => promise; return promise; };

function localInspectionFixture(changes = {}) {
  const binding = LOCAL_BINDING, target = { host: "127.0.0.1", port: 5439 };
  const identity = { backend_pid: 1235, server_version_num: 170011, data_directory: binding.dataDirectory,
    system_identifier: binding.systemIdentifier, postmaster_start_epoch: "1788796000", ssl_cert_file: "server.crt", ssl_key_file: "server.key", ssl: true,
    ...changes.sql };
  const dependencies = {
    platform: changes.platform ?? "darwin", uid: 501,
    lstat: async file => ({ isDirectory: () => file === binding.dataDirectory, isFile: () => file !== binding.dataDirectory,
      isSymbolicLink: () => false, uid: 501, mode: file === binding.dataDirectory ? 0o700
        : file.includes("/bin/") ? 0o755 : file.endsWith("server.key") && changes.publicKeyFile ? 0o644 : 0o600 }),
    realpath: async file => file.startsWith("/proc/") ? binding.postgres.file : file,
    fileSha256: async file => { const tool = file === binding.postgres.file ? binding.postgres : binding.pgControlData; return { bytes: tool.bytes, sha256: tool.sha256 }; },
    readFile: async file => file.endsWith("server.crt") ? TEST_LEAF
      : `1234\n${binding.dataDirectory}\n1788796000\n5439\n\n127.0.0.1\n12345 678\nready\n`,
    run: async (file, args) => {
      if (args[0] === "--version") return { stdout: `${path.basename(file)} (PostgreSQL) ${changes.serverToolVersion ?? "17.11"}` };
      if (file === binding.pgControlData.file) return { stdout: `Database system identifier: ${changes.controlId ?? binding.systemIdentifier}` };
      if (file === "/bin/ps") return { stdout: args[1] === "1234" ? `501 1 ${changes.executable ?? binding.postgres.file}`
        : `501 ${changes.backendParent ?? 1234} postgres: local verifier` };
      if (file.endsWith("/lsof")) return { stdout: `p${changes.listenerPid ?? 1234}\nf5\nn127.0.0.1:5439\n` };
      throw new Error("unexpected OS inspection");
    },
  };
  return { binding, target, options: { sql: { unsafe: () => pending([identity]) }, dependencies } };
}
test("local restore inspection binds the listener, postmaster, control ID and SQL child on Darwin and Linux", async () => {
  for (const platform of ["darwin", "linux"]) {
    const f = localInspectionFixture({ platform }), result = await inspectModuleRestore(f.binding, f.target, TEST_LEAF, f.options);
    assert.equal(result.postmasterPid, 1234); assert.equal(result.serverVersionNum, 170011); assert.equal(result.platform, platform);
    assert.equal(result.certificateDerSha256, sha256(new X509Certificate(TEST_LEAF).raw));
  }
});
for (const [label, changes] of [
  ["a remote-loopback tunnel owns the local listener", { listenerPid: 4321 }],
  ["SQL returns a foreign backend PID lineage", { backendParent: 4321 }],
  ["postmaster runs a different binary", { executable: "/usr/local/foreign/postgres" }],
  ["control system identifier differs", { controlId: "987654321" }],
  ["the actual server uses a different major", { sql: { server_version_num: 160011 } }],
  ["the local server tool uses a different major", { serverToolVersion: "18.0" }],
  ["the local key is not private", { publicKeyFile: true }],
  ["the OS has no supported inspection", { platform: "win32" }],
]) test(`local restore rejects ${label}`, async () => {
  const f = localInspectionFixture(changes);
  await assert.rejects(inspectModuleRestore(f.binding, f.target, TEST_LEAF, f.options), /Module|Postgres/u);
});
test("each new Node TLS connection requires the exact single self-signed leaf and matching host", () => {
  const certificate = new X509Certificate(TEST_LEAF), peer = certificate.toLegacyObject(), options = moduleRestoreTlsOptions(TEST_LEAF, "127.0.0.1");
  assert.equal(options.rejectUnauthorized, true); assert.equal(options.checkServerIdentity("127.0.0.1", peer), undefined);
  assert.match(options.checkServerIdentity("127.0.0.1", { ...peer, raw: Buffer.from("other leaf") }).message, /TLS peer differs/u);
  assert.ok(moduleRestoreTlsOptions(TEST_LEAF, "192.0.2.1").checkServerIdentity("192.0.2.1", peer) instanceof Error);
  assert.throws(() => moduleRestoreTlsOptions(TEST_LEAF + TEST_LEAF, "127.0.0.1"), /leaf/u);
});
function sqlFor(db) {
  return { unsafe(query, parameters = []) {
    const result = db.query(query, parameters).then(value => value.rows);
    result.simple = () => result;
    result.cursor = async function* (count) { assert.equal(count, 1); for (const row of await result) yield [row]; };
    return result;
  } };
}
async function databaseFixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE SCHEMA ${API}; CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[]);
    INSERT INTO supabase_migrations.schema_migrations VALUES('0031',ARRAY['fixture DDL bytes']);
    ${REQUIRED.map(name => `CREATE TABLE ${API}.${name}(record_id text PRIMARY KEY, revoked boolean, record jsonb);`).join("\n")}
    CREATE TABLE ${API}.module_source_drafts_v1(submission_id text PRIMARY KEY, request_hash text, exact_request_bytes bytea,
      source_byte_length integer, raw_amount numeric(78,0));
    INSERT INTO ${API}.module_source_drafts_v1 VALUES('source-1','${h(42)}',decode('01020304','hex'),4,1152921504606846977);
    INSERT INTO ${API}.api_credentials VALUES('credential-1',true,'{"scopes":["modules:read"]}');
    INSERT INTO ${API}.module_review_decisions_v1 VALUES('decision-1',false,'{"outcome":"reject","artifactDigest":"${h(43)}"}');
    ALTER TABLE ${API}.module_source_drafts_v1 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${API}.module_source_drafts_v1 FORCE ROW LEVEL SECURITY;`);
  return db;
}

test("current Module profile captures exact source/auth/review bytes and restores a PGlite data archive without float loss", async t => {
  const source = await databaseFixture(t), before = await captureDatabaseManifest(sqlFor(source), PROFILE);
  const backup = await source.dumpDataDir();
  const restored = new PGlite({ loadDataDir: backup }); t.after(() => restored.close());
  assert.deepEqual(await captureDatabaseManifest(sqlFor(restored), PROFILE), before);
  const draft = before.tables.find(table => table.table === "module_source_drafts_v1");
  assert.equal(draft.exactRequestBytes, "4"); assert.equal(draft.rawIntegerSums.raw_amount, "1152921504606846977");
  assert.equal(before.tableCount, 12); assert.equal(before.rowCount, 4);
  await restored.exec(`UPDATE ${API}.api_credentials SET revoked=false`);
  const changed = await captureDatabaseManifest(sqlFor(restored), PROFILE);
  assert.notEqual(changed.manifestSha256, before.manifestSha256);
  assert.notEqual(changed.tables.find(table => table.table === "api_credentials").rowsSha256,
    before.tables.find(table => table.table === "api_credentials").rowsSha256);
});
test("missing Module tables, migration history and an unqualified schema profile fail closed", async t => {
  const db = await databaseFixture(t);
  assert.deepEqual(BACKUP_SCHEMAS, ["programmable_private", "programmable_release_probe_private", "supabase_migrations"]);
  await assert.rejects(captureDatabaseManifest(sqlFor(db), { schemas: MODULE_MODE_BACKUP_SCHEMAS }), /schema stage/u);
  await assert.rejects(captureDatabaseManifest(sqlFor(db), { ...PROFILE, schemas: BACKUP_SCHEMAS }), /profile/u);
  await db.exec("DROP TABLE supabase_migrations.schema_migrations");
  await assert.rejects(captureDatabaseManifest(sqlFor(db), PROFILE), /incomplete/u);
});
test("the current schema profile excludes unrelated global historical role defaults while retaining its schema ACLs", async t => {
  const db = await databaseFixture(t), before = await captureDatabaseManifest(sqlFor(db), PROFILE);
  await db.exec(`CREATE ROLE programmable_migrator;
    ALTER DEFAULT PRIVILEGES FOR ROLE programmable_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`);
  assert.deepEqual(await captureDatabaseManifest(sqlFor(db), PROFILE), before);
  await db.exec(`REVOKE USAGE ON SCHEMA ${API} FROM PUBLIC; GRANT USAGE ON SCHEMA ${API} TO programmable_migrator;`);
  assert.notEqual((await captureDatabaseManifest(sqlFor(db), PROFILE)).portableStructuralManifestSha256,
    before.portableStructuralManifestSha256);
});

async function captureFixture(t, changes = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "module-recovery-test-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await databaseFixture(t), manifest = await captureDatabaseManifest(sqlFor(source), PROFILE), commands = [], sourceSql = [];
  let captures = 0, snapshotReads = 0;
  const snapshotIdentity = { backend_pid: 998, database_name: "postgres", session_user: "postgres", current_role: "postgres", server_version_num: 170006,
    isolation: "repeatable read", read_only: "on", transaction_snapshot: "100:102:101", transaction_started_at: "2026-09-07T12:00:00.000000Z", ...changes.snapshotIdentity };
  const input = { ...PROFILE, operationId: "module-recovery-fixture", repositoryCommit: "a".repeat(40), expectedProjectRef: "mnnvlrqwhfoppogslsje",
    sourceDatabaseUrl: "postgresql://postgres:fixture_source_password@db.mnnvlrqwhfoppogslsje.supabase.co:5432/postgres?sslmode=verify-full",
    sslCaPem: `-----BEGIN CERTIFICATE-----\n${"A".repeat(96)}\n-----END CERTIFICATE-----`,
    restoreDatabaseUrl: "postgresql://postgres:fixture_restore_password@127.0.0.1:5439/programmable_restore_module_fixture?sslmode=verify-full",
    restoreIsolationId: "module_fixture", restoreSslCaPem: TEST_LEAF, restoreBinding: LOCAL_BINDING,
    backupPath: path.join(directory, "database.dump"), evidencePath: path.join(directory, "database-evidence.json"),
    dependencies: {
      openHostedDatabase: async () => ({ sql: { unsafe: query => {
        sourceSql.push(query);
        if (query.includes("pg_export_snapshot")) return pending([{ snapshot_id: "00000004-00000012-1", exported_at: "2026-09-07T12:00:00.001000Z", ...snapshotIdentity }]);
        if (query.includes("pg_current_snapshot")) { snapshotReads++; return pending([{ ...snapshotIdentity, ...(snapshotReads === changes.changeSnapshotAtRead ? { backend_pid: 999 } : {}) }]); }
        if (query.startsWith("select version,")) return pending([{ version: "0031", name: "fixture_migration", statements: ["fixture DDL bytes"] }]);
        if (query === "rollback") return pending(Object.assign([], { command: "ROLLBACK" }));
        return pending([]);
      } } }),
      inspectModuleRestore: async (binding, target) => ({ ...binding, postmasterStartEpoch: "1788796000", certificateDerSha256: h(88),
        serverVersionNum: 170011, listenerHost: target.host, listenerPort: target.port, platform: "darwin", processOwnerUid: 501 }),
      openRestoreDatabase: async ({ safeTarget }) => ({ sql: { unsafe: query => {
        if (query.includes("session_user")) return pending([{ session_user: "postgres", current_role: "postgres", database_name: safeTarget.database, server_port: 5439, in_recovery: false }]);
        if (query.includes("schema_count")) return pending([{ schema_count: 0, object_count: 0 }]);
        if (query.includes("server_address")) return pending([{ server_address: "127.0.0.1", superuser: true, other_databases: 0, extra_schemas: 0, public_objects: 0, ...(safeTarget.database === "postgres" ? changes.postgresIsolation : changes.isolation) }]);
        throw new Error("unexpected restore query");
      } } }),
      closeHostedDatabase: async () => {},
      captureDatabaseManifest: async (_sql, profile) => { assert.deepEqual(profile, PROFILE); captures++;
        return changes.drift && captures === 2 ? { ...manifest, manifestSha256: h(99) } : manifest; },
      runCommand: async (binary, args, options) => {
        commands.push({ binary, args, env: options.env });
        assert.ok(!JSON.stringify(args).includes("fixture_source_password")); assert.ok(!JSON.stringify(args).includes("fixture_restore_password"));
        if (args.includes("--version")) return { stdout: Buffer.from(`${path.basename(binary)} (PostgreSQL) ${changes.versions?.[path.basename(binary)] ?? "17.11"}`) };
        if (args.includes("--file")) await writeFile(args[args.indexOf("--file") + 1], "PGDMP fixture bytes, not a real pg_dump", { mode: 0o600 });
        return { stdout: Buffer.from("fixture archive listing") };
      },
    } };
  return { input, commands, sourceSql, directory };
}
test("existing dump/restore orchestration with mocked processes uses read-only source and exact local profile without credential output", async t => {
  const f = await captureFixture(t), result = await createBackupAndRestoreEvidence(f.input);
  const proof = validateModuleRecoveryDatabaseEvidence(result.evidence);
  assert.equal(f.sourceSql[0], "set default_transaction_read_only = on");
  assert.ok(f.sourceSql.includes("begin isolation level repeatable read read only")); assert.equal(f.sourceSql.at(-1), "rollback");
  const dump = f.commands.find(command => command.args.includes("--file"));
  assert.equal(dump.env.PGOPTIONS, "-c default_transaction_read_only=on");
  assert.equal(dump.args[dump.args.indexOf("--snapshot") + 1], "00000004-00000012-1");
  assert.equal(dump.args.includes("--serializable-deferrable"), false);
  assert.deepEqual(dump.args.filter((_arg, index, args) => args[index - 1] === "--schema"), MODULE_MODE_BACKUP_SCHEMAS);
  const restore = f.commands.find(command => command.binary === "pg_restore" && command.args.includes("--single-transaction"));
  assert.ok(restore.args.includes("programmable_restore_module_fixture"));
  assert.ok(f.commands.find(command => command.binary === "psql" && !command.args.includes("--version")).args.join(" ").includes("NOLOGIN"));
  assert.equal(proof.rpo, "unavailable"); assert.ok(proof.restoreElapsedMs >= 0); assert.equal(proof.productionRestorePerformed, false);
  assert.deepEqual(proof.clientVersions, { pg_dump: "PostgreSQL 17.11", pg_restore: "PostgreSQL 17.11", psql: "PostgreSQL 17.11" });
  assert.equal(proof.localRestore.serverVersionNum, 170011); assert.equal(proof.localRestore.postgresDatabaseEmpty, true);
  assert.equal(proof.sourceSnapshot.releaseMethod, "ROLLBACK"); assert.equal(proof.sourceSnapshot.identity.server_version_num, 170006);
  assert.equal(proof.sourceSnapshot.migrations[0].version, "0031");
  assert.equal(JSON.stringify(result).includes("fixture_source_password"), false);
  const idempotent = await createBackupAndRestoreEvidence(f.input); assert.equal(idempotent.changed, false);
});
for (const isolation of [{ server_address: "10.2.3.4" }, { superuser: false }, { other_databases: 1 }, { extra_schemas: 1 }, { public_objects: 1 }]) {
  test(`rejects a nonisolated target ${JSON.stringify(isolation)} before dump or restore`, async t => {
    const f = await captureFixture(t, { isolation }); await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
    assert.equal(f.commands.length, 0); assert.equal(f.sourceSql.length, 0);
  });
}
for (const postgresIsolation of [{ extra_schemas: 1 }, { public_objects: 1 }]) {
  test(`rejects application objects in the separate postgres database ${JSON.stringify(postgresIsolation)}`, async t => {
    const f = await captureFixture(t, { postgresIsolation }); await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
    assert.equal(f.commands.length, 0); assert.equal(f.sourceSql.length, 0);
  });
}
for (const databaseName of ["programmable_restore_module_fixture", "postgres"]) {
  test(`literal system-schema prefix check rejects actual pgdata.keep_me in ${databaseName}`, async t => {
    const f = await captureFixture(t), db = new PGlite(); t.after(() => db.close());
    await db.exec("CREATE SCHEMA pgdata; CREATE TABLE pgdata.keep_me(id integer)");
    const openRestore = f.input.dependencies.openRestoreDatabase;
    let inspected = false;
    f.input.dependencies.openRestoreDatabase = async options => {
      const connection = await openRestore(options), unsafe = connection.sql.unsafe;
      connection.sql.unsafe = (query, parameters) => {
        if (options.safeTarget.database !== databaseName || !query.includes("server_address")) return unsafe(query, parameters);
        const result = db.query(query, parameters).then(({ rows }) => {
          inspected = true; assert.equal(rows[0].extra_schemas, 1);
          return [{ ...rows[0], server_address: "127.0.0.1", superuser: true }];
        });
        result.simple = () => result; return result;
      };
      return connection;
    };
    await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
    assert.equal(inspected, true); assert.equal(f.commands.length, 0); assert.equal(f.sourceSql.length, 0);
    assert.equal((await db.query("SELECT to_regclass('pgdata.keep_me')::text AS existing")).rows[0].existing, "pgdata.keep_me");
  });
}
for (const program of ["pg_dump", "pg_restore", "psql"]) {
  test(`requires Postgres 17 for ${program} before dump or target DDL`, async t => {
    const f = await captureFixture(t, { versions: { [program]: "16.11" } });
    await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
    assert.equal(f.commands.some(command => !command.args.includes("--version")), false);
  });
}
test("local identity is rechecked around fresh mutating connections and a changed binding stops the next restore", async t => {
  const f = await captureFixture(t), inspect = f.input.dependencies.inspectModuleRestore, runner = f.input.dependencies.runCommand;
  let inspections = 0, mutated = false;
  f.input.dependencies.inspectModuleRestore = async (...args) => { inspections++; if (mutated) throw new Error("local binding changed"); return inspect(...args); };
  f.input.dependencies.runCommand = async (...args) => {
    if (args[0] === "psql" && args[1].includes("--command")) { assert.equal(inspections, 4); mutated = true; }
    return runner(...args);
  };
  await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
  assert.equal(f.commands.some(command => command.args.includes("--single-transaction")), false);
});
test("source drift rejects the proof and retains the captured archive for inspection", async t => {
  const f = await captureFixture(t, { drift: true }); await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
  assert.ok((await stat(f.input.backupPath)).size > 0);
  assert.equal(f.commands.some(command => command.args.includes("--single-transaction")), false);
  assert.equal(f.sourceSql.at(-1), "rollback");
});
for (const snapshotIdentity of [{ read_only: "off" }, { isolation: "read committed" }, { server_version_num: 160011 }]) {
  test(`rejects an unqualified source snapshot ${JSON.stringify(snapshotIdentity)}`, async t => {
    const f = await captureFixture(t, { snapshotIdentity });
    await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
    assert.equal(f.commands.length, 0); assert.equal(f.sourceSql.at(-1), "rollback");
  });
}
for (const changeSnapshotAtRead of [1, 2]) {
  test(`source snapshot identity must remain bound at check ${changeSnapshotAtRead}`, async t => {
    const f = await captureFixture(t, { changeSnapshotAtRead });
    await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
    assert.equal(f.commands.some(command => command.args.includes("--single-transaction")), false); assert.equal(f.sourceSql.at(-1), "rollback");
  });
}
test("a failed dump rolls back the source snapshot before closing without local DDL", async t => {
  const f = await captureFixture(t), runner = f.input.dependencies.runCommand;
  f.input.dependencies.runCommand = async (...args) => { if (args[1].includes("--file")) throw new Error("fixture dump failed"); return runner(...args); };
  await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
  assert.equal(f.sourceSql.at(-1), "rollback"); assert.equal(f.commands.some(command => command.args.includes("--command")), false);
});
test("source snapshot is released before the first local mutation and stored proof requires rollback evidence", async t => {
  const f = await captureFixture(t), runner = f.input.dependencies.runCommand;
  f.input.dependencies.runCommand = async (...args) => { if (args[1].includes("--command")) assert.equal(f.sourceSql.at(-1), "rollback"); return runner(...args); };
  const { evidence } = await createBackupAndRestoreEvidence(f.input);
  const bad = structuredClone(evidence); delete bad.moduleRecovery.sourceSnapshot.releaseMethod;
  assert.throws(() => validateModuleRecoveryDatabaseEvidence(bad), /snapshot evidence/u);
});
test("an acknowledged source capture survives a later local restore failure as a separate private receipt", async t => {
  const f = await captureFixture(t), runner = f.input.dependencies.runCommand;
  f.input.dependencies.runCommand = async (...args) => { if (args[1].includes("--single-transaction")) throw new Error("fixture restore failure"); return runner(...args); };
  await assert.rejects(createBackupAndRestoreEvidence(f.input), /database backup and isolated restore failed/u);
  const file = f.input.evidencePath + ".source-capture.json", capture = JSON.parse(await readFile(file, "utf8"));
  assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal(capture.status, "snapshot-capture-verified");
  assert.equal(capture.sourceSnapshot.releaseMethod, "ROLLBACK"); assert.equal(capture.before.manifestSha256, capture.after.manifestSha256);
  assert.equal(capture.backup.sha256, sha256(await readFile(f.input.backupPath))); assert.equal(capture.localRestorePerformed, false);
  assert.equal(capture.sourceDatabaseMutated, false); await assert.rejects(readFile(f.input.evidencePath), { code: "ENOENT" });
});
test("the fixed restored ACL roles use the existing contracts and stay inert without membership edges", async t => {
  const f = await captureFixture(t); await createBackupAndRestoreEvidence(f.input);
  const command = f.commands.find(command => command.args.includes("--command"));
  const bootstrap = command.args[command.args.indexOf("--command") + 1], db = new PGlite(); t.after(() => db.close());
  await db.exec(bootstrap);
  const names = ["programmable_custom_launch_api_runtime", "anon", "authenticated", "service_role", "programmable_custom_launch_api_operator",
    ...["api", "signer", "observer", "verifier", "projector", "release_operator", "source_authority"].map(name => "programmable_custom_launch_v4_" + name),
    "programmable_custom_launch_multi_role_admission_v2"];
  const { rows } = await db.query("select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname=any($1::text[])", [names]);
  assert.deepEqual(rows.map(row => row.rolname).sort(), names.sort());
  assert.ok(rows.every(row => Object.entries(row).every(([key, value]) => key === "rolname" || value === false)));
  assert.equal((await db.query("select count(*)::integer as count from pg_auth_members where roleid in (select oid from pg_roles where rolname=any($1::text[])) or member in (select oid from pg_roles where rolname=any($1::text[]))", [names])).rows[0].count, 0);
  await db.exec("ALTER ROLE programmable_custom_launch_v4_api LOGIN");
  await assert.rejects(db.exec(bootstrap), /local recovery role is not isolated/u);
  await db.exec("ALTER ROLE programmable_custom_launch_v4_api NOLOGIN; GRANT pg_read_all_data TO programmable_custom_launch_v4_api");
  await assert.rejects(db.exec(bootstrap), /local recovery role is not isolated/u);
});
test("the explicit Module profile normalizes only literal IPv6 loopback for local libpq commands", async t => {
  const f = await captureFixture(t, { isolation: { server_address: "::1" } });
  f.input.restoreDatabaseUrl = f.input.restoreDatabaseUrl.replace("127.0.0.1", "[::1]");
  await createBackupAndRestoreEvidence(f.input);
  const restore = f.commands.find(command => command.args.includes("--single-transaction"));
  assert.equal(restore.args[restore.args.indexOf("--host") + 1], "::1");
});

async function indexFixture() {
  const tools = await loadRecoveryIndexTools(), evidence = JSON.parse(await readFile(new URL("../../tests/fixtures/module-engine-index.json", import.meta.url), "utf8"));
  const f = evidence.cases[1], row = { sourceKind: f.normalized.sourceVersion, sourceAddress: f.normalized.host,
    sourceReleaseDigest: f.normalized.sourceReleaseDigest };
  const collector = { listAuthorizedSources: async () => ({ releases: [f.release], unavailableSources: [] }), authenticateRelease: async () => {},
    finalizedBoundary: async () => ({ chainId: 4663, sourceReleaseDigest: f.release.releaseDigest, blockNumber: "100", blockHash: f.normalized.blockHash, verificationDigest: h(1) }),
    canonicalBlock: async (_release, number) => ({ chainId: 4663, blockNumber: number.toString(), blockHash: number === 100n ? f.normalized.blockHash : h(number) }),
    collectRange: async (_release, from, to) => ({ ...f.range, fromBlock: from.toString(), toBlock: to.toString(), complete: true }) };
  const source = await tools.moduleModeSource(f.release, collector), rows = await source.launches(100n, 100n, []);
  const point = { number: "100", hash: f.normalized.blockHash };
  const snapshot = { version: 1, chainId: 4663, routerAddress: "0x" + "1".repeat(40), binding: h(2), startBlock: "100", cursor: point,
    checkpoints: [point], finalizedBlock: "100", updatedAt: "2026-09-07T12:00:00Z", items: [], moduleMode: {
      version: 1, chainId: 4663, sourceKind: row.sourceKind, sourceAddress: row.sourceAddress, releaseDigest: row.sourceReleaseDigest,
      startBlock: f.release.startBlock, cursor: point, checkpoints: [point], finalizedBlock: "100", updatedAt: "2026-09-07T12:00:00Z", items: rows } };
  const customSource = { routerAddress: snapshot.routerAddress, binding: snapshot.binding, startBlock: 100n, finalized: point, block: async () => point, launches: async () => [] };
  return { tools, collector, customSource, snapshot, evidence: f };
}
test("canonical point parity and replay use actual shared Engine normalization and retain source/checkpoint identities", async () => {
  const f = await indexFixture(), result = await replayRecoveryIndex(f.snapshot, f);
  assert.equal(result.observations.length, 2); assert.equal(result.verifiedBlocks, 1);
  assert.deepEqual(result.snapshot.moduleMode.items, f.snapshot.moduleMode.items);
  assert.equal(result.observations[1].releaseDigest, f.evidence.release.releaseDigest);
  assert.equal(result.observations[1].replay.status, "ready");
});
test("recovery refuses missing bootstrap, unavailable sources, substituted claims and changed canonical blocks", async () => {
  const f = await indexFixture();
  await assert.rejects(replayRecoveryIndex(null, f), /BOOTSTRAP/u);
  await assert.rejects(replayRecoveryIndex({ ...f.snapshot, cursor: null, items: [], checkpoints: [] }, f), /BOOTSTRAP/u);
  const substituted = structuredClone(f.snapshot); substituted.moduleMode.items[0].transactionHash = h(101);
  await assert.rejects(replayRecoveryIndex(substituted, f), /PARITY/u);
  const unavailable = { ...f.collector, listAuthorizedSources: async () => ({ releases: [], unavailableSources: [{ releaseId: "module-mode-engine-v1", reasonCode: "MODULE_MODE_RELEASE_UNAVAILABLE" }] }) };
  await assert.rejects(replayRecoveryIndex(f.snapshot, { ...f, collector: unavailable }), /SOURCE_INVENTORY/u);
  const bad = { ...f.collector, canonicalBlock: async () => ({ chainId: 4663, blockNumber: "100", blockHash: h(102) }) };
  await assert.rejects(replayRecoveryIndex(f.snapshot, { ...f, collector: bad }), /boundary changed/u);
});
test("CLI exposes one bounded current capture and rejects null or missing configuration without connection", async () => {
  assert.match((await main(["--help"])).effects, /No source database or Blob writes/u);
  await assert.rejects(main(["restore-production"]), /ARGUMENTS_INVALID/u);
  assert.throws(() => validateRecoveryConfig(null), /CONFIG_INVALID/u);
  await assert.rejects(main(["capture", "--config-file", "/this-file-does-not-exist", "--output-directory", "/unused", "--confirm-isolated-target", "no"]), /INPUT_FILE_UNAVAILABLE/u);
});
test("strict archive parsing preserves the Blob budget, rejects duplicate keys and interoperates with existing canonical JSON", async () => {
  const tools = await loadRecoveryIndexTools(), value = { row: "a".repeat(1024 * 1024 + 1) };
  assert.equal(canonicalJson(tools.parseStrictJson(JSON.stringify(value))), canonicalJson(value));
  assert.throws(() => tools.parseStrictJson('{"row":1,"row":2}'), /Duplicate/u);
});

const ARCHIVE_KINDS = ["source", "compiler", "dependencies", "abi", "review", "deployment", "lifecycle", "operator"];
function configFixture() {
  return { schemaVersion: "programmable.module-mode-recovery-config.v1", operationId: "recovery-fixture", repositoryCommit: "a".repeat(40),
    expectedSourceProjectRef: "mnnvlrqwhfoppogslsje", sourceDatabaseUrlFile: "/private/input/source-url", sourceCaFile: "/private/input/source-ca",
    restoreBinding: LOCAL_BINDING, restoreIsolationId: "module_fixture", restoreDatabaseUrlFile: "/private/input/restore-url", restoreCaFile: "/private/input/restore-ca",
    blobFile: "/private/input/index.json", blobEtag: '"' + "a".repeat(32) + '"', blobSha256: h(7), blobBytes: 500,
    backendBaseUrl: "https://fixture.example/", websiteTokenFile: "/private/input/website-token",
    archiveFiles: ARCHIVE_KINDS.map(kind => ({ kind, file: `/private/input/${kind}.bin`, bytes: 1, sha256: h(8) })),
    tools: Object.fromEntries(["pg_dump", "pg_restore", "psql"].map(tool => [tool, { file: `/private/bin/${tool}`, bytes: 1, sha256: h(9) }])) };
}
test("operator configuration requires exact project, bounded pinned archive bytes and a complete existing evidence inventory", () => {
  const config = configFixture(); assert.equal(validateRecoveryConfig(config), config);
  for (const bad of [{ ...config, expectedSourceProjectRef: "unknown" }, { ...config, arbitrarySourcePath: "/db" },
    { ...config, archiveFiles: config.archiveFiles.slice(1) }, { ...config, blobBytes: 16 * 1024 * 1024 + 1 },
    { ...config, archiveFiles: [{ ...config.archiveFiles[0], sha256: "missing" }, ...config.archiveFiles.slice(1)] },
    { ...config, backendBaseUrl: "https://fixture.example/arbitrary-path" },
    { ...config, tools: { ...config.tools, arbitraryTool: config.tools.psql } }]) assert.throws(() => validateRecoveryConfig(bad), /MODULE_RECOVERY_/u);
});
test("private capsule verification checks retained bytes and the independent manifest digest without claiming another restore", async t => {
  const f = await captureFixture(t), result = await createBackupAndRestoreEvidence(f.input), index = await indexFixture();
  const directory = await realpath(f.directory); await chmod(directory, 0o700);
  const indexBytes = Buffer.from(canonicalJson(index.snapshot) + "\n"), archives = [];
  for (const filename of ["index-original.json", "index-restored.json"]) await writeFile(path.join(directory, filename), indexBytes, { mode: 0o600 });
  for (const [i, kind] of ARCHIVE_KINDS.entries()) {
    const file = `artifact-${String(i).padStart(2, "0")}.bin`, bytes = Buffer.from(`fixture ${kind} bytes`);
    await writeFile(path.join(directory, file), bytes, { mode: 0o600 }); archives.push({ kind, file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const databaseEvidenceBytes = await readFile(f.input.evidencePath);
  const manifest = { schemaVersion: "programmable.module-mode-recovery-manifest.v1", status: "isolated-restore-and-canonical-replay-verified",
    productionRestorePerformed: false, productionActivationAuthorized: false,
    database: { file: "database.dump", ...result.evidence.backup, evidenceFile: "database-evidence.json", evidenceSha256: sha256(databaseEvidenceBytes),
      tables: result.evidence.moduleRecovery.source.tables },
    index: { file: "index-original.json", bytes: indexBytes.length, sha256: sha256(indexBytes), restoredFile: "index-restored.json",
      restoredSha256: sha256(indexBytes), decoderBundleSha256: index.tools.decoderBundleSha256 }, archiveFiles: archives };
  const manifestBytes = Buffer.from(canonicalJson(manifest) + "\n"), digest = sha256(manifestBytes);
  await writeFile(path.join(directory, "manifest.json"), manifestBytes, { mode: 0o600 });
  assert.deepEqual(await verifyRecoveryCapsule(directory, digest), { status: "local-capsule-integrity-verified", manifestSha256: digest, productionActivationAuthorized: false });
  await assert.rejects(verifyRecoveryCapsule(directory, h(1)), /MANIFEST_DIGEST_DIFFERS/u);
  await writeFile(path.join(directory, archives[0].file), "corrupted");
  await assert.rejects(verifyRecoveryCapsule(directory, digest), /CAPSULE_FILE_DIFFERS/u);
  const escaped = { ...manifest, archiveFiles: [{ ...archives[0], file: "../outside.bin" }] };
  const escapedBytes = Buffer.from(canonicalJson(escaped) + "\n"); await writeFile(path.join(directory, "manifest.json"), escapedBytes);
  await assert.rejects(verifyRecoveryCapsule(directory, sha256(escapedBytes)), /CAPSULE_FILE_INVALID/u);
});
