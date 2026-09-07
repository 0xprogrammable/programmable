import { createHash, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import {
  constants as fsConstants,
  chmod,
  lstat,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { checkServerIdentity } from "node:tls";

import postgres from "postgres";

import {
  assertNoSecretOutput,
  canonicalJson,
  sha256,
  validateDirectSupabaseTarget,
} from "./hosted-db-operator-core.mjs";
import {
  closeHostedDatabase,
  openHostedDatabase,
} from "./hosted-db-postgres.mjs";

const executeFile = promisify(execFile);
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const OPERATION_ID = /^[a-z0-9][a-z0-9._-]{7,63}$/u;
const ISOLATION_ID = /^[a-z0-9][a-z0-9_-]{7,31}$/u;
const SHA256 = /^0x[0-9a-f]{64}$/u;
const PG_TOOL_VERSION = /\b(\d+)\.(?:\d+)(?:\.\d+)?\b/u;
const RESTORE_DATABASE_PREFIX = "programmable_restore_";
const POOLER_CREDENTIAL_REFRESH_DELAY_MS = 250;
export const BACKUP_SCHEMAS = Object.freeze([
  "programmable_private",
  "programmable_release_probe_private",
  "supabase_migrations",
]);
export const FINAL_BACKUP_SCHEMAS = Object.freeze([
  "programmable_private",
  "programmable_release_probe_private",
  "programmable_wake_private",
  "supabase_migrations",
]);
// An explicit current profile; the retired Candidate defaults stay unchanged.
export const MODULE_MODE_RECOVERY_PROFILE = "programmable.module-mode-recovery.v1";
export const MODULE_MODE_BACKUP_SCHEMAS = Object.freeze(["programmable_custom_launch_api_v1", "supabase_migrations"]);
const MODULE_RECOVERY_TABLES = Object.freeze(["principals", "wallet_bindings", "api_credentials", "api_credential_scopes",
  "api_scopes", "module_source_drafts_v1", "module_submission_keys_v1", "module_request_budgets_v1",
  "module_review_jobs_v1", "module_review_attempts_v1", "module_review_decisions_v1"]);
function moduleRecoveryProfile(profile, schemas) {
  if (profile === undefined) return false;
  if (profile !== MODULE_MODE_RECOVERY_PROFILE || canonicalJson(schemas) !== canonicalJson(MODULE_MODE_BACKUP_SCHEMAS)) {
    throw new Error("Module recovery profile is invalid");
  }
  return true;
}
export function validateModuleRestoreBinding(value) {
  if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(["dataDirectory", "pgControlData", "postgres", "postmasterPid", "systemIdentifier"].sort())
    || typeof value.dataDirectory !== "string" || !path.isAbsolute(value.dataDirectory) || value.dataDirectory.includes("\0")
    || !Number.isSafeInteger(value.postmasterPid) || value.postmasterPid <= 1
    || !/^[1-9][0-9]{0,19}$/u.test(value.systemIdentifier ?? "") || BigInt(value.systemIdentifier) > 18446744073709551615n) {
    throw new Error("Module local restore binding is invalid");
  }
  for (const tool of [value.postgres, value.pgControlData]) {
    if (!isPlainRecord(tool) || canonicalJson(Object.keys(tool).sort()) !== canonicalJson(["bytes", "file", "sha256"])
      || typeof tool.file !== "string" || !path.isAbsolute(tool.file) || !Number.isSafeInteger(tool.bytes) || tool.bytes <= 0
      || !SHA256.test(tool.sha256 ?? "")) throw new Error("Module local server tool binding is invalid");
  }
  return value;
}

function moduleRestoreCertificate(pem) {
  if (typeof pem !== "string" || (pem.match(/-----BEGIN CERTIFICATE-----/gu) ?? []).length !== 1
    || !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/u.test(pem.trim())) throw new Error("Module local TLS leaf is invalid");
  const certificate = new X509Certificate(pem);
  if (pem.trim().replaceAll("\r\n", "\n") !== certificate.toString().trim()
    || certificate.ca || certificate.subject !== certificate.issuer || !certificate.verify(certificate.publicKey)
    || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
    throw new Error("Module restore requires its own valid self-signed non-CA TLS leaf");
  }
  return certificate;
}

export function moduleRestoreTlsOptions(pem, host) {
  const certificate = moduleRestoreCertificate(pem);
  return { rejectUnauthorized: true, ca: certificate.toString(), checkServerIdentity: (_hostname, peer) => {
    if (!Buffer.isBuffer(peer.raw) || !peer.raw.equals(certificate.raw)) return new Error("Module local TLS peer differs");
    return checkServerIdentity(host, peer);
  } };
}

// PID and listener ownership are local OS observations, never assertions from a remote SQL server.
// Every new libpq connection also trusts only this local non-CA server leaf.
export async function inspectModuleRestore(binding, target, sslCaPem, { sql, dependencies = {} } = {}) {
  validateModuleRestoreBinding(binding);
  const ops = { lstat, readFile, realpath, fileSha256, run: executeFile, platform: process.platform, uid: process.getuid?.(), ...dependencies };
  if (!["darwin", "linux"].includes(ops.platform) || !Number.isSafeInteger(ops.uid)) throw new Error("Module local process inspection is unavailable");
  const privatePath = async (file, directory = false) => {
    const stat = await ops.lstat(file);
    if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() || stat.uid !== ops.uid
      || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) || await ops.realpath(file) !== file) throw new Error("Module local data path is not private");
  };
  await privatePath(binding.dataDirectory, true);
  for (const name of ["postmaster.pid", "server.crt", "server.key"]) await privatePath(path.join(binding.dataDirectory, name));
  const pidLines = (await ops.readFile(path.join(binding.dataDirectory, "postmaster.pid"), "utf8")).trimEnd().split("\n");
  if (Number(pidLines[0]) !== binding.postmasterPid || pidLines[1] !== binding.dataDirectory || Number(pidLines[3]) !== target.port
    || !/^[1-9][0-9]*$/u.test(pidLines[2] ?? "") || pidLines[7]?.trim() !== "ready") throw new Error("Module local postmaster identity differs");
  const certificate = moduleRestoreCertificate(sslCaPem);
  if ((await ops.readFile(path.join(binding.dataDirectory, "server.crt"), "utf8")).trim() !== sslCaPem.trim()) throw new Error("Module local TLS leaf differs");
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" };
  const run = async (file, args) => String((await ops.run(file, args, { env, timeout: 10000, maxBuffer: 1024 * 1024 })).stdout).trim();
  for (const [key, program] of [["postgres", "postgres"], ["pgControlData", "pg_controldata"]]) {
    const tool = binding[key], stat = await ops.lstat(tool.file);
    if (!stat.isFile() || stat.isSymbolicLink() || ![0, ops.uid].includes(stat.uid) || (stat.mode & 0o022) !== 0
      || await ops.realpath(tool.file) !== tool.file || canonicalJson(await ops.fileSha256(tool.file)) !== canonicalJson({ bytes: tool.bytes, sha256: tool.sha256 })) {
      throw new Error("Module local server binary differs");
    }
    pgVersion(await run(tool.file, ["--version"]), program);
  }
  const control = await run(binding.pgControlData.file, [binding.dataDirectory]);
  if (control.match(/^Database system identifier:\s+([0-9]+)$/mu)?.[1] !== binding.systemIdentifier) throw new Error("Module local control identity differs");
  const processRow = async pid => {
    const row = (await run("/bin/ps", ["-p", String(pid), "-o", "uid=,ppid=,comm="])).match(/^\s*([0-9]+)\s+([0-9]+)\s+(.+)$/u);
    if (!row || Number(row[1]) !== ops.uid) throw new Error("Module local process owner differs");
    return { parent: Number(row[2]), command: row[3] };
  };
  const postmaster = await processRow(binding.postmasterPid);
  const executable = ops.platform === "linux" ? await ops.realpath(`/proc/${binding.postmasterPid}/exe`) : postmaster.command;
  if (executable !== binding.postgres.file) throw new Error("Module local postmaster executable differs");
  const listeners = (await run(ops.platform === "darwin" ? "/usr/sbin/lsof" : "/usr/bin/lsof",
    ["-nP", "-iTCP:" + target.port, "-sTCP:LISTEN", "-Fpn"])).split("\n");
  const listenerPids = listeners.filter(line => line.startsWith("p")).map(line => Number(line.slice(1)));
  const addresses = listeners.filter(line => line.startsWith("n")).map(line => line.slice(1));
  if (listenerPids.length !== 1 || listenerPids[0] !== binding.postmasterPid || addresses.length !== 1
    || addresses[0] !== (target.host === "::1" ? "[::1]:" : "127.0.0.1:") + target.port) throw new Error("Module local listener is not the bound postmaster");
  let serverVersionNum = null;
  if (sql) {
    const [identity] = await sql.unsafe(`select pg_backend_pid()::integer as backend_pid,
      current_setting('server_version_num')::integer as server_version_num,
      current_setting('data_directory') as data_directory,
      (select system_identifier::text from pg_control_system()) as system_identifier,
      floor(extract(epoch from pg_postmaster_start_time()))::bigint::text as postmaster_start_epoch,
      current_setting('ssl_cert_file') as ssl_cert_file, current_setting('ssl_key_file') as ssl_key_file,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as ssl`);
    if (identity?.data_directory !== binding.dataDirectory || identity.system_identifier !== binding.systemIdentifier
      || identity.postmaster_start_epoch !== pidLines[2] || identity.ssl_cert_file !== "server.crt" || identity.ssl_key_file !== "server.key"
      || identity.ssl !== true || !Number.isInteger(identity.server_version_num) || Math.floor(identity.server_version_num / 10000) !== 17
      || !Number.isSafeInteger(identity.backend_pid) || (await processRow(identity.backend_pid)).parent !== binding.postmasterPid) {
      throw new Error("Module SQL connection is not a child of the bound local Postgres 17 server");
    }
    serverVersionNum = identity.server_version_num;
  }
  return { ...binding, postmasterStartEpoch: pidLines[2], certificateDerSha256: sha256(certificate.raw), serverVersionNum,
    listenerHost: target.host, listenerPort: target.port, platform: ops.platform, processOwnerUid: ops.uid };
}
const RESTORE_ROLE_NAMES = Object.freeze([
  "programmable_api_reader",
  "programmable_api_reader_login",
  "programmable_maintenance",
  "programmable_migrator",
  "programmable_operator",
  "programmable_profile_binder",
  "programmable_profile_recovery",
  "programmable_profile_writer",
  "programmable_projector",
  "programmable_projector_login",
  "programmable_projector_runtime",
  "programmable_projector_runtime_login",
  "programmable_reconciler",
  "programmable_reconciler_login",
  "programmable_release_probe_nonce",
  "programmable_release_probe_nonce_login",
]);

function freezeRoleSpec(spec) {
  return Object.freeze(spec);
}

export const ROLE_SPECS = Object.freeze([
  freezeRoleSpec({
    key: "apiReader",
    loginRole: "programmable_api_reader_login",
    capabilityRole: "programmable_api_reader",
  }),
  freezeRoleSpec({
    key: "projector",
    loginRole: "programmable_projector_login",
    capabilityRole: "programmable_projector",
  }),
  freezeRoleSpec({
    key: "projectorRuntime",
    loginRole: "programmable_projector_runtime_login",
    capabilityRole: "programmable_projector_runtime",
  }),
  freezeRoleSpec({
    key: "reconciler",
    loginRole: "programmable_reconciler_login",
    capabilityRole: "programmable_reconciler",
  }),
  freezeRoleSpec({
    key: "releaseProbe",
    loginRole: "programmable_release_probe_nonce_login",
    capabilityRole: "programmable_release_probe_nonce",
  }),
]);

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateCaPem(value, label = "Postgres CA") {
  if (
    typeof value !== "string" ||
    value.length < 64 ||
    value.length > 32_768 ||
    !value.includes("-----BEGIN CERTIFICATE-----") ||
    !value.includes("-----END CERTIFICATE-----") ||
    value.includes("PRIVATE KEY")
  ) {
    throw new Error(`${label} must be a server-only PEM certificate`);
  }
  return value;
}

function readExactCredentials(credentials) {
  if (!isPlainRecord(credentials)) {
    throw new Error("exactly five login-role credentials are required");
  }
  const expectedKeys = ROLE_SPECS.map(({ key }) => key).sort();
  const actualKeys = Object.keys(credentials).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("exactly five login-role credentials are required");
  }
  const values = new Map();
  const uniquePasswords = new Set();
  for (const spec of ROLE_SPECS) {
    const descriptor = Object.getOwnPropertyDescriptor(credentials, spec.key);
    const password = descriptor?.value;
    if (
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      typeof password !== "string" ||
      password.length < 32 ||
      password.length > 256 ||
      [...password].some((character) => {
        const code = character.codePointAt(0);
        return code === undefined || code < 0x21 || code > 0x7e;
      })
    ) {
      throw new Error(`credential ${spec.key} is not a valid generated password`);
    }
    if (uniquePasswords.has(password)) {
      throw new Error("login-role credentials must be unique");
    }
    uniquePasswords.add(password);
    values.set(spec.key, password);
  }
  return values;
}

function errorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{2,16}$/u.test(code)
    ? code
    : undefined;
}

function operationalFailure(label, error) {
  const code = errorCode(error);
  return new Error(`${label} failed${code ? ` (${code})` : ""}`);
}

function validateDependencies(value, allowed) {
  if (value === undefined) return Object.freeze({});
  if (!isPlainRecord(value)) throw new Error("dependencies must be an object");
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) || typeof value[key] !== "function") {
      throw new Error("dependencies contain an unsupported entry");
    }
  }
  return value;
}

function staticRolePasswordSql(spec) {
  return `
do $credential_rotation$
declare
  credential_value text;
begin
  credential_value := pg_catalog.current_setting(
    'programmable.credential_rotation', true
  );
  if credential_value is null or pg_catalog.length(credential_value) < 32 then
    raise exception 'credential rotation input is absent';
  end if;
  execute pg_catalog.format(
    'alter role %I password %L valid until %L',
    '${spec.loginRole}',
    credential_value,
    'infinity'
  );
  perform pg_catalog.set_config(
    'programmable.credential_rotation', '', true
  );
end
$credential_rotation$;
`;
}

function isExactRoleFlagPosture(row, expectedLogin) {
  return (
    row &&
    row.rolcanlogin === expectedLogin &&
    row.rolsuper === false &&
    row.rolcreatedb === false &&
    row.rolcreaterole === false &&
    row.rolinherit === false &&
    row.rolreplication === false &&
    row.rolbypassrls === false &&
    Number(row.rolconnlimit) === -1 &&
    (row.rolconfig === null ||
      (Array.isArray(row.rolconfig) && row.rolconfig.length === 0))
  );
}

async function readRolePosture(sql, { requirePasswords }) {
  const names = ROLE_SPECS.flatMap(({ loginRole, capabilityRole }) => [
    loginRole,
    capabilityRole,
  ]);
  const rows = await sql.unsafe(
    `
      select
        roles.rolname,
        roles.rolcanlogin,
        roles.rolsuper,
        roles.rolcreatedb,
        roles.rolcreaterole,
        roles.rolinherit,
        roles.rolreplication,
        roles.rolbypassrls,
        roles.rolconnlimit,
        roles.rolconfig,
        auth.rolpassword is not null as has_password
      from pg_catalog.pg_roles as roles
      join pg_catalog.pg_authid as auth
        on auth.rolname = roles.rolname
      where roles.rolname = any($1::text[])
      order by roles.rolname
    `,
    [names],
  );
  const memberships = await sql.unsafe(
    `
      select
        member_role.rolname as member_role,
        granted_role.rolname as granted_role,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      where member_role.rolname = any($1::text[])
      order by member_role.rolname, granted_role.rolname
    `,
    [ROLE_SPECS.map(({ loginRole }) => loginRole)],
  );
  return { rows, memberships, requirePasswords };
}

async function readPoolerRolePosture(sql) {
  const names = ROLE_SPECS.flatMap(({ loginRole, capabilityRole }) => [
    loginRole,
    capabilityRole,
  ]);
  const rows = await sql.unsafe(
    `
      select
        rolname,
        rolcanlogin,
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolinherit,
        rolreplication,
        rolbypassrls,
        rolconnlimit,
        rolconfig,
        false as has_password
      from pg_catalog.pg_roles
      where rolname = any($1::text[])
      order by rolname
    `,
    [names],
  );
  const memberships = await sql.unsafe(
    `
      select
        member_role.rolname as member_role,
        granted_role.rolname as granted_role,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      where member_role.rolname = any($1::text[])
      order by member_role.rolname, granted_role.rolname
    `,
    [ROLE_SPECS.map(({ loginRole }) => loginRole)],
  );
  return { rows, memberships, requirePasswords: false };
}

function assertRolePosture(posture) {
  if (!posture || !Array.isArray(posture.rows) || !Array.isArray(posture.memberships)) {
    throw new Error("database role posture response is invalid");
  }
  const rowByName = new Map(posture.rows.map((row) => [row?.rolname, row]));
  if (rowByName.size !== ROLE_SPECS.length * 2) {
    throw new Error("database role set does not match the reviewed role set");
  }
  for (const spec of ROLE_SPECS) {
    const login = rowByName.get(spec.loginRole);
    const capability = rowByName.get(spec.capabilityRole);
    if (
      !isExactRoleFlagPosture(login, true) ||
      !isExactRoleFlagPosture(capability, false) ||
      (posture.requirePasswords === true && login.has_password !== true)
    ) {
      throw new Error("database role posture does not match the reviewed posture");
    }
    const memberships = posture.memberships.filter(
      ({ member_role: memberRole }) => memberRole === spec.loginRole,
    );
    if (
      memberships.length !== 1 ||
      memberships[0]?.granted_role !== spec.capabilityRole ||
      memberships[0]?.admin_option !== false ||
      memberships[0]?.inherit_option !== false ||
      memberships[0]?.set_option !== true
    ) {
      throw new Error("database role membership does not match the reviewed posture");
    }
  }
  return true;
}

async function assertDirectOperatorIdentity(sql) {
  const [identity] = await sql.unsafe(`
    select
      session_user::text as session_user,
      current_user::text as current_user,
      current_role::text as current_role,
      pg_catalog.current_database()::text as database_name,
      pg_catalog.inet_server_port()::integer as server_port,
      pg_catalog.pg_has_role(
        session_user, 'postgres', 'member'
      ) as is_postgres_member
  `);
  if (
    !["postgres", "cli_login_postgres"].includes(identity?.session_user) ||
    identity?.current_user !== "postgres" ||
    identity?.current_role !== "postgres" ||
    identity?.database_name !== "postgres" ||
    Number(identity?.server_port) !== 5432 ||
    (identity?.session_user === "cli_login_postgres" &&
      identity?.is_postgres_member !== true)
  ) {
    throw new Error("direct database operator identity is not approved");
  }
}

async function rotateLoginPassword(sql, spec, password) {
  await sql.begin(async (transaction) => {
    const [identity] = await transaction.unsafe(`
      select session_user::text as session_user,
             current_role::text as current_role
    `);
    if (
      identity?.session_user !== "postgres" ||
      identity?.current_role !== "postgres"
    ) {
      throw new Error("credential rotation operator identity changed");
    }
    await transaction`
      select pg_catalog.set_config(
        'programmable.credential_rotation', ${password}, true
      )
    `;
    await transaction.unsafe(staticRolePasswordSql(spec)).simple();
  });
}

export async function provisionLoginRoles(input) {
  if (!isPlainRecord(input)) throw new Error("provisioning input is invalid");
  const credentials = readExactCredentials(input.credentials);
  validateCaPem(input.sslCaPem);
  const target = validateDirectSupabaseTarget(
    input.databaseUrl,
    input.expectedProjectRef,
  );
  const dependencies = validateDependencies(input.dependencies, [
    "openHostedDatabase",
    "closeHostedDatabase",
    "assertDirectOperatorIdentity",
    "readRolePosture",
    "rotateLoginPassword",
  ]);
  const openDatabase = dependencies.openHostedDatabase ?? openHostedDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const assertIdentity =
    dependencies.assertDirectOperatorIdentity ?? assertDirectOperatorIdentity;
  const inspect = dependencies.readRolePosture ?? readRolePosture;
  const rotate = dependencies.rotateLoginPassword ?? rotateLoginPassword;
  let connection;
  try {
    connection = await openDatabase({
      databaseUrl: input.databaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: input.sslCaPem,
    });
    if (canonicalJson(connection.target) !== canonicalJson(target)) {
      throw new Error("direct database target identity changed");
    }
    await assertIdentity(connection.sql);
    assertRolePosture(
      await inspect(connection.sql, { requirePasswords: false }),
    );
    for (const spec of ROLE_SPECS) {
      await rotate(connection.sql, spec, credentials.get(spec.key));
    }
    assertRolePosture(
      await inspect(connection.sql, { requirePasswords: true }),
    );
    return Object.freeze({
      kind: "programmable-login-role-provisioning-result",
      schemaVersion: 1,
      target,
      roles: Object.freeze(
        ROLE_SPECS.map(({ loginRole, capabilityRole }) =>
          Object.freeze({ loginRole, capabilityRole, provisioned: true }),
        ),
      ),
    });
  } catch (error) {
    throw operationalFailure("login-role provisioning", error);
  } finally {
    if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
  }
}

function validatePoolerTarget({ expectedProjectRef, poolerHost }) {
  if (!PROJECT_REF.test(expectedProjectRef ?? "")) {
    throw new Error("expected Supabase project ref is invalid");
  }
  if (
    typeof poolerHost !== "string" ||
    !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(poolerHost)
  ) {
    throw new Error("shared Supabase pooler host is invalid");
  }
  return Object.freeze({
    projectRef: expectedProjectRef,
    host: poolerHost,
    port: 6543,
    database: "postgres",
    sslMode: "verify-full",
    prepare: false,
  });
}

function poolerConnectionUrl(target, spec, password) {
  const url = new URL("postgresql://placeholder:placeholder@localhost/postgres");
  url.hostname = target.host;
  url.port = String(target.port);
  url.username = `${spec.loginRole}.${target.projectRef}`;
  url.password = password;
  url.searchParams.set("sslmode", "verify-full");
  return url;
}

async function openPoolerDatabase({ target, spec, password, sslCaPem }) {
  const connectionUrl = poolerConnectionUrl(target, spec, password);
  const sql = postgres({
    host: connectionUrl.hostname,
    port: Number(connectionUrl.port),
    database: connectionUrl.pathname.slice(1),
    username: decodeURIComponent(connectionUrl.username),
    password: decodeURIComponent(connectionUrl.password),
    ssl: { rejectUnauthorized: true, ca: sslCaPem },
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 5,
    max_lifetime: 30,
    onnotice: () => {},
    connection: {
      application_name: "programmable-pooler-role-verifier",
    },
  });
  return { sql };
}

async function closePoolerDatabase(sql) {
  await sql.end({ timeout: 3 });
}

async function waitForPoolerCredentialRefresh() {
  await new Promise((resolve) => {
    setTimeout(resolve, POOLER_CREDENTIAL_REFRESH_DELAY_MS);
  });
}

function staticSetLocalRoleSql(spec) {
  return `set local role ${spec.capabilityRole}`;
}

async function verifyPoolerSession(sql, spec) {
  return sql.begin(async (transaction) => {
    const [before] = await transaction.unsafe(`
      select
        session_user::text as session_user,
        current_role::text as current_role,
        pg_catalog.current_database()::text as database_name
    `);
    if (
      before?.session_user !== spec.loginRole ||
      before?.current_role !== spec.loginRole ||
      before?.database_name !== "postgres"
    ) {
      throw new Error("pooler session login identity does not match");
    }
    await transaction.unsafe(staticSetLocalRoleSql(spec)).simple();
    const [after] = await transaction.unsafe(`
      select
        session_user::text as session_user,
        current_role::text as current_role,
        pg_catalog.current_setting('role', true)::text as configured_role,
        pg_catalog.current_database()::text as database_name
    `);
    if (
      after?.session_user !== spec.loginRole ||
      after?.current_role !== spec.capabilityRole ||
      after?.configured_role !== spec.capabilityRole ||
      after?.database_name !== "postgres"
    ) {
      throw new Error("pooler session capability identity does not match");
    }
    return Object.freeze({
      loginRole: spec.loginRole,
      capabilityRole: spec.capabilityRole,
      verified: true,
    });
  });
}

export async function verifyPoolerLogins(input) {
  if (!isPlainRecord(input)) throw new Error("pooler verification input is invalid");
  const credentials = readExactCredentials(input.credentials);
  const sslCaPem = validateCaPem(input.sslCaPem);
  const target = validatePoolerTarget(input);
  const dependencies = validateDependencies(input.dependencies, [
    "openPoolerDatabase",
    "closePoolerDatabase",
    "readPoolerRolePosture",
    "verifyPoolerSession",
    "waitForPoolerCredentialRefresh",
  ]);
  const openDatabase = dependencies.openPoolerDatabase ?? openPoolerDatabase;
  const closeDatabase = dependencies.closePoolerDatabase ?? closePoolerDatabase;
  const inspectPosture =
    dependencies.readPoolerRolePosture ?? readPoolerRolePosture;
  const verifySession = dependencies.verifyPoolerSession ?? verifyPoolerSession;
  const waitForCredentialRefresh =
    dependencies.waitForPoolerCredentialRefresh ?? waitForPoolerCredentialRefresh;
  const roles = [];
  try {
    for (const spec of ROLE_SPECS) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let connection;
        let retryAfterCredentialRefresh = false;
        try {
          connection = await openDatabase({
            target,
            spec,
            password: credentials.get(spec.key),
            sslCaPem,
            options: Object.freeze({ prepare: false }),
          });
          assertRolePosture(await inspectPosture(connection.sql));
          roles.push(await verifySession(connection.sql, spec));
          break;
        } catch (error) {
          retryAfterCredentialRefresh =
            attempt === 0 && errorCode(error) === "28P01";
          if (!retryAfterCredentialRefresh) throw error;
        } finally {
          if (connection?.sql) await closeDatabase(connection.sql).catch(() => {});
        }
        if (retryAfterCredentialRefresh) await waitForCredentialRefresh();
      }
    }
    if (roles.length !== ROLE_SPECS.length) {
      throw new Error("not every reviewed pooler login was verified");
    }
    return Object.freeze({
      kind: "programmable-pooler-login-verification-result",
      schemaVersion: 1,
      target,
      roles: Object.freeze(roles),
    });
  } catch (error) {
    throw operationalFailure("pooler login verification", error);
  }
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("database credential encoding is invalid");
  }
}

function parseSourceTarget(
  databaseUrl,
  expectedProjectRef,
  allowedSourceUsernames = ["postgres"],
) {
  const parsed = new URL(databaseUrl);
  const username = decodeUrlComponent(parsed.username);
  if (
    !Array.isArray(allowedSourceUsernames) ||
    ![
      canonicalJson(["postgres"]),
      canonicalJson(["postgres", "cli_login_postgres"]),
    ].includes(canonicalJson(allowedSourceUsernames)) ||
    !allowedSourceUsernames.includes(username)
  ) {
    throw new Error("source database operator identity is not approved");
  }
  const ownerUrl = new URL(databaseUrl);
  ownerUrl.username = "postgres";
  const safeTarget = validateDirectSupabaseTarget(
    ownerUrl.toString(),
    expectedProjectRef,
  );
  const password = decodeUrlComponent(parsed.password);
  if (password.length < 1 || /[\u0000-\u001f\u007f]/u.test(password)) {
    throw new Error("source database credential is invalid");
  }
  return { safeTarget, password, username };
}

function parseRestoreTarget(databaseUrl, isolationId, normalizeIpv6 = false) {
  if (!ISOLATION_ID.test(isolationId ?? "")) {
    throw new Error("restore isolation id is invalid");
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("isolated restore database URL is invalid");
  }
  const parameters = [...parsed.searchParams.entries()];
  const expectedDatabase = `${RESTORE_DATABASE_PREFIX}${isolationId}`;
  const port = Number(parsed.port);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "[::1]", "::1", "localhost"].includes(parsed.hostname) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    parsed.pathname !== `/${expectedDatabase}` ||
    parsed.username !== "postgres" ||
    parsed.password.length < 1 ||
    parsed.hash !== "" ||
    parameters.length !== 1 ||
    parameters[0][0] !== "sslmode" ||
    parameters[0][1] !== "verify-full"
  ) {
    throw new Error(
      "restore target must be an isolated loopback database with sslmode=verify-full",
    );
  }
  const password = decodeUrlComponent(parsed.password);
  if (/[\u0000-\u001f\u007f]/u.test(password)) {
    throw new Error("restore database credential is invalid");
  }
  return {
    safeTarget: Object.freeze({
      isolationId,
      host: normalizeIpv6 && parsed.hostname === "[::1]" ? "::1" : parsed.hostname,
      port,
      database: expectedDatabase,
      sslMode: "verify-full",
    }),
    password,
    username: "postgres",
  };
}

function validateAbsoluteOutputPath(value, label) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.length > 1024 ||
    path.basename(value) === "" ||
    value.includes("\u0000")
  ) {
    throw new Error(`${label} must be an absolute file path`);
  }
  return path.normalize(value);
}

function backupRequestPayload({
  operationId,
  repositoryCommit,
  source,
  restore,
  schemas,
}) {
  return {
    kind: "programmable-database-backup-restore-request",
    schemaVersion: 1,
    operationId,
    repositoryCommit,
    source,
    restore,
    schemas,
    format: "targeted-schema-backup-v2",
  };
}

function validateBackupRequest(input) {
  if (!isPlainRecord(input)) throw new Error("backup and restore input is invalid");
  if (!OPERATION_ID.test(input.operationId ?? "")) {
    throw new Error("backup operation id is invalid");
  }
  if (!COMMIT.test(input.repositoryCommit ?? "")) {
    throw new Error("repository commit must be an exact full commit hash");
  }
  const sslCaPem = validateCaPem(input.sslCaPem, "source Postgres CA");
  const restoreSslCaPem = validateCaPem(
    input.restoreSslCaPem,
    "restore Postgres CA",
  );
  const source = parseSourceTarget(
    input.sourceDatabaseUrl,
    input.expectedProjectRef,
    input.allowedSourceUsernames,
  );
  const restore = parseRestoreTarget(
    input.restoreDatabaseUrl,
    input.restoreIsolationId,
    input.profile === MODULE_MODE_RECOVERY_PROFILE,
  );
  const schemas = Object.freeze([...(input.schemas ?? BACKUP_SCHEMAS)]);
  const moduleRecovery = moduleRecoveryProfile(input.profile, schemas);
  if (
    !moduleRecovery &&
    canonicalJson(schemas) !== canonicalJson(BACKUP_SCHEMAS) &&
    canonicalJson(schemas) !== canonicalJson(FINAL_BACKUP_SCHEMAS)
  ) {
    throw new Error("backup schema stage is invalid");
  }
  const backupPath = validateAbsoluteOutputPath(input.backupPath, "backup path");
  const evidencePath = validateAbsoluteOutputPath(
    input.evidencePath,
    "evidence path",
  );
  if (backupPath === evidencePath) {
    throw new Error("backup and evidence paths must differ");
  }
  const payload = backupRequestPayload({
    operationId: input.operationId,
    repositoryCommit: input.repositoryCommit,
    source: source.safeTarget,
    restore: restore.safeTarget,
    schemas,
  });
  if (moduleRecovery) {
    payload.profile = MODULE_MODE_RECOVERY_PROFILE;
    payload.restoreBinding = validateModuleRestoreBinding(input.restoreBinding);
  }
  return {
    ...(moduleRecovery ? { profile: MODULE_MODE_RECOVERY_PROFILE, restoreBinding: payload.restoreBinding } : {}),
    operationId: input.operationId,
    repositoryCommit: input.repositoryCommit,
    source,
    restore,
    schemas,
    sslCaPem,
    restoreSslCaPem,
    backupPath,
    evidencePath,
    requestSha256: sha256(canonicalJson(payload)),
  };
}

async function safeExistingFile(filePath) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error("operator artifact is not a private regular file");
  }
  return metadata;
}

async function fileSha256(filePath) {
  const file = await open(filePath, "r"), hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
  let bytes = 0;
  try {
    const before = await file.stat();
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead)); bytes += bytesRead;
    }
    const after = await file.stat();
    if (before.size !== bytes || after.size !== bytes || before.mtimeMs !== after.mtimeMs) throw new Error("operator artifact changed while hashing");
    return { bytes, sha256: `0x${hash.digest("hex")}` };
  } finally { await file.close(); }
}

export function validateModuleRecoveryDatabaseEvidence(value) {
  const proof = value?.moduleRecovery;
  if (value?.kind !== "programmable-database-backup-restore-evidence" || value.backup?.format !== "pg-custom-v1"
    || canonicalJson(value.schemas) !== canonicalJson(MODULE_MODE_BACKUP_SCHEMAS) || proof?.profile !== MODULE_MODE_RECOVERY_PROFILE
    || proof.productionRestorePerformed !== false || proof.independentArchiveCopies !== "unavailable" || proof.rpo !== "unavailable"
    || !Number.isFinite(proof.restoreElapsedMs) || proof.restoreElapsedMs < 0 || !Number.isFinite(proof.totalElapsedMs)
    || proof.totalElapsedMs < proof.restoreElapsedMs || !Number.isFinite(Date.parse(proof.sourceCaptureWindow?.startedAt))
    || !Number.isFinite(Date.parse(proof.sourceCaptureWindow?.finishedAt))
    || Date.parse(proof.sourceCaptureWindow?.finishedAt) < Date.parse(proof.sourceCaptureWindow?.startedAt)
    || !Array.isArray(proof.source?.tables) || !Array.isArray(proof.restored?.tables)
    || canonicalJson(proof.source.tables) !== canonicalJson(proof.restored.tables)
    || MODULE_RECOVERY_TABLES.some(name => !proof.source.tables.some(table => table.schema === MODULE_MODE_BACKUP_SCHEMAS[0] && table.table === name))
    || !proof.source.tables.some(table => table.schema === "supabase_migrations" && table.table === "schema_migrations")) {
    throw new Error("Module recovery database evidence is incomplete");
  }
  const binding = proof.localRestore;
  validateModuleRestoreBinding(binding?.binding);
  if (!Number.isInteger(binding.serverVersionNum) || Math.floor(binding.serverVersionNum / 10000) !== 17
    || !/^[1-9][0-9]*$/u.test(binding.postmasterStartEpoch ?? "") || !SHA256.test(binding.certificateDerSha256 ?? "")
    || !["127.0.0.1", "::1"].includes(binding.listenerHost) || binding.listenerHost !== value.restore?.host
    || binding.listenerPort !== value.restore?.port || !["darwin", "linux"].includes(binding.platform)
    || !Number.isSafeInteger(binding.processOwnerUid) || binding.processOwnerUid < 0 || binding.postgresDatabaseEmpty !== true
    || canonicalJson(Object.keys(proof.clientVersions ?? {}).sort()) !== canonicalJson(["pg_dump", "pg_restore", "psql"])) {
    throw new Error("Module local restore evidence is incomplete");
  }
  for (const version of Object.values(proof.clientVersions)) pgVersion(version);
  for (const [side, prefix] of [[proof.source, "source"], [proof.restored, "restored"]]) {
    if (side.profile !== MODULE_MODE_RECOVERY_PROFILE || side.manifestSha256 !== value[`${prefix}ManifestSha256`]
      || !SHA256.test(side.manifestSha256) || side.structuralManifestSha256 !== value[`${prefix}StructuralManifestSha256`]
      || side.portableStructuralManifestSha256 !== value[`${prefix}PortableStructuralManifestSha256`]
      || side.tableCount !== value.tableCount || side.rowCount !== value.rowCount) throw new Error("Module recovery database commitment differs");
  }
  return proof;
}

function validateStoredEvidence(value, request) {
  if (request.profile === MODULE_MODE_RECOVERY_PROFILE) validateModuleRecoveryDatabaseEvidence(value);
  const hasSourceStructuralManifest = Object.hasOwn(
    value ?? {},
    "sourceStructuralManifestSha256",
  );
  const hasRestoredStructuralManifest = Object.hasOwn(
    value ?? {},
    "restoredStructuralManifestSha256",
  );
  const hasSourcePortableStructuralManifest = Object.hasOwn(
    value ?? {},
    "sourcePortableStructuralManifestSha256",
  );
  const hasRestoredPortableStructuralManifest = Object.hasOwn(
    value ?? {},
    "restoredPortableStructuralManifestSha256",
  );
  if (
    !isPlainRecord(value) ||
    value.kind !== "programmable-database-backup-restore-evidence" ||
    value.schemaVersion !== 1 ||
    value.operationId !== request.operationId ||
    value.repositoryCommit !== request.repositoryCommit ||
    value.requestSha256 !== request.requestSha256 ||
    canonicalJson(value.source) !== canonicalJson(request.source.safeTarget) ||
    canonicalJson(value.restore) !== canonicalJson(request.restore.safeTarget) ||
    !isPlainRecord(value.backup) ||
    !SHA256.test(value.backup.sha256 ?? "") ||
    !SHA256.test(value.backup.archiveListSha256 ?? "") ||
    !["pg-custom-v1", "empty-target-schemas-v1"].includes(
      value.backup.format,
    ) ||
    !Number.isSafeInteger(value.backup.bytes) ||
    value.backup.bytes <= 0 ||
    !SHA256.test(value.sourceManifestSha256 ?? "") ||
    value.restoredManifestSha256 !== value.sourceManifestSha256 ||
    hasSourceStructuralManifest !== hasRestoredStructuralManifest ||
    (hasSourceStructuralManifest &&
      (!SHA256.test(value.sourceStructuralManifestSha256 ?? "") ||
        !SHA256.test(value.restoredStructuralManifestSha256 ?? ""))) ||
    hasSourcePortableStructuralManifest !==
      hasRestoredPortableStructuralManifest ||
    (hasSourcePortableStructuralManifest
      ? !SHA256.test(value.sourcePortableStructuralManifestSha256 ?? "") ||
        value.restoredPortableStructuralManifestSha256 !==
          value.sourcePortableStructuralManifestSha256
      : hasSourceStructuralManifest &&
        value.restoredStructuralManifestSha256 !==
          value.sourceStructuralManifestSha256) ||
    !Number.isSafeInteger(value.tableCount) ||
    value.tableCount < 0 ||
    !Number.isSafeInteger(value.rowCount) ||
    value.rowCount < 0 ||
    (value.tableCount === 0) !==
      (value.backup.format === "empty-target-schemas-v1") ||
    !/^PostgreSQL 17\./u.test(value.postgresVersion ?? "") ||
    !Number.isFinite(Date.parse(value.createdAt ?? ""))
  ) {
    throw new Error("stored backup and restore evidence is invalid or conflicting");
  }
  return value;
}

async function readIdempotentEvidence(request) {
  const [backupMetadata, evidenceMetadata] = await Promise.all([
    safeExistingFile(request.backupPath),
    safeExistingFile(request.evidencePath),
  ]);
  if (!backupMetadata && !evidenceMetadata) return null;
  if (!backupMetadata || !evidenceMetadata) {
    throw new Error("partial backup evidence conflicts with the requested operation");
  }
  let evidence;
  try {
    evidence = JSON.parse(await readFile(request.evidencePath, "utf8"));
  } catch {
    throw new Error("stored backup and restore evidence is invalid or conflicting");
  }
  validateStoredEvidence(evidence, request);
  const backup = await fileSha256(request.backupPath);
  if (
    backup.sha256 !== evidence.backup.sha256 ||
    backup.bytes !== evidence.backup.bytes
  ) {
    throw new Error("stored backup artifact conflicts with its evidence");
  }
  return Object.freeze({
    kind: "programmable-database-backup-restore-result",
    schemaVersion: 1,
    status: "current",
    changed: false,
    evidence: Object.freeze(evidence),
  });
}

async function createPrivateFile(filePath, contents = "") {
  const descriptor = await open(
    filePath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      (fsConstants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    if (contents !== "") await descriptor.writeFile(contents, "utf8");
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
  await chmod(filePath, 0o600);
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("private operator artifact permissions are invalid");
  }
}

async function createTemporaryCa(caPem) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "programmable-pg-ca-"));
  await chmod(directory, 0o700);
  const filePath = path.join(directory, "server-ca.crt");
  try {
    await createPrivateFile(filePath, caPem);
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function safeChildEnvironment({ password, caPath, applicationName }) {
  const environment = {
    LANG: "C",
    LC_ALL: "C",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    PGAPPNAME: applicationName,
    PGCONNECT_TIMEOUT: "8",
    PGPASSWORD: password,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: caPath,
  };
  if (process.platform === "win32" && process.env.SYSTEMROOT) {
    environment.SYSTEMROOT = process.env.SYSTEMROOT;
  }
  return environment;
}

async function runCommand(binary, args, options) {
  const result = await executeFile(binary, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return {
    stdout: Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(result.stdout ?? ""),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(result.stderr ?? ""),
  };
}

function assertCommandContainsNoSecrets(args, secrets) {
  const serialized = args.join("\u0000");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0 && serialized.includes(secret)) {
      throw new Error("database secret reached a child-process argument");
    }
  }
}

async function executeSafeCommand({
  runner,
  binary,
  args,
  env,
  timeoutMs,
  secrets,
  expectedBinary,
}) {
  assertCommandContainsNoSecrets(args, secrets);
  if (expectedBinary !== undefined) {
    if (typeof binary !== "string" || !path.isAbsolute(binary)) {
      throw new Error("pinned Postgres tool path must be absolute");
    }
    const actual = await fileSha256(binary);
    if (
      actual.bytes !== expectedBinary.bytes ||
      actual.sha256 !== expectedBinary.sha256
    ) {
      throw new Error("pinned Postgres tool changed before execution");
    }
  }
  try {
    const result = await runner(binary, Object.freeze([...args]), {
      cwd: path.dirname(args.at(-1) ?? process.cwd()),
      env: Object.freeze({ ...env }),
      timeoutMs,
    });
    return {
      stdout: Buffer.isBuffer(result?.stdout)
        ? result.stdout
        : Buffer.from(result?.stdout ?? ""),
      stderr: Buffer.isBuffer(result?.stderr)
        ? result.stderr
        : Buffer.from(result?.stderr ?? ""),
    };
  } catch (error) {
    throw operationalFailure("Postgres backup tool", error);
  }
}

function commandTargetArguments(target, username) {
  return [
    "--host",
    target.host,
    "--port",
    String(target.port),
    "--username",
    username,
    "--dbname",
    target.database,
    "--no-password",
  ];
}

function roleBootstrapSql(profile) {
  if (profile === MODULE_MODE_RECOVERY_PROFILE) {
    // The dedicated local cluster has no production logins or credential material.
    return ["programmable_custom_launch_api_runtime", "anon", "authenticated", "service_role"].map(role =>
      `DO $module_roles$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}' AND NOT rolcanlogin AND NOT rolsuper
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls)
          OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='${role}')
            OR member=(SELECT oid FROM pg_roles WHERE rolname='${role}')) THEN
          RAISE EXCEPTION 'local recovery role is not isolated'; END IF;
        ELSE CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
        END IF; END $module_roles$;`).join("\n");
  }
  const body = RESTORE_ROLE_NAMES.map(
    (role) => `
      if not exists (
        select 1 from pg_catalog.pg_roles where rolname = '${role}'
      ) then
        create role ${role}
          nologin nosuperuser nocreatedb nocreaterole noinherit
          noreplication nobypassrls;
      end if;
      alter role ${role}
        nologin nosuperuser nocreatedb nocreaterole noinherit
        noreplication nobypassrls;`,
  ).join("\n");
  return `do $programmable_restore_roles$ begin ${body}\nend $programmable_restore_roles$;
alter default privileges for role programmable_migrator
  revoke execute on functions from public;
alter default privileges for role programmable_migrator
  grant execute on functions to programmable_migrator;
alter default privileges for role programmable_migrator
  revoke usage on types from public;
alter default privileges for role programmable_migrator
  grant usage on types to programmable_migrator;`;
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 63) {
    throw new Error("database catalog identifier is invalid");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

const BOOLEAN_DEFINITION_WORDS = new Set(["AND", "OR"]);
const NON_ASSOCIATIVE_BOOLEAN_CONTEXT = new Set([
  "BETWEEN",
  "CASE",
  "ELSE",
  "END",
  "FILTER",
  "ORDER",
  "OVER",
  "SELECT",
  "THEN",
  "WHEN",
  "WITHIN",
]);

function postgresDefinitionTokens(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Postgres definition is invalid");
  }
  const tokens = [];
  let offset = 0;
  const pushQuoted = (quote) => {
    const start = offset;
    offset += 1;
    while (offset < value.length) {
      if (value[offset] === "\\") {
        offset += Math.min(2, value.length - offset);
        continue;
      }
      if (value[offset] === quote) {
        if (value[offset + 1] === quote) {
          offset += 2;
          continue;
        }
        offset += 1;
        tokens.push({ kind: "quoted", value: value.slice(start, offset) });
        return;
      }
      offset += 1;
    }
    throw new Error("Postgres definition contains an unterminated quote");
  };
  while (offset < value.length) {
    const character = value[offset];
    if (/\s/u.test(character)) {
      offset += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      pushQuoted(character);
      continue;
    }
    if (character === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(
        value.slice(offset),
      )?.[0];
      if (tag) {
        const end = value.indexOf(tag, offset + tag.length);
        if (end < 0) {
          throw new Error("Postgres definition contains an unterminated dollar quote");
        }
        tokens.push({
          kind: "quoted",
          value: value.slice(offset, end + tag.length),
        });
        offset = end + tag.length;
        continue;
      }
    }
    if (/[A-Za-z_]/u.test(character)) {
      const start = offset;
      offset += 1;
      while (offset < value.length && /[A-Za-z0-9_$]/u.test(value[offset])) {
        offset += 1;
      }
      tokens.push({ kind: "word", value: value.slice(start, offset) });
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = offset;
      offset += 1;
      while (offset < value.length && /[0-9A-Fa-f_xX.eE+-]/u.test(value[offset])) {
        if (
          ["+", "-"].includes(value[offset]) &&
          !["e", "E"].includes(value[offset - 1])
        ) {
          break;
        }
        offset += 1;
      }
      tokens.push({ kind: "number", value: value.slice(start, offset) });
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ kind: "parenthesis", value: character });
      offset += 1;
      continue;
    }
    if (/[,.;\[\]]/u.test(character)) {
      tokens.push({ kind: "punctuation", value: character });
      offset += 1;
      continue;
    }
    if (/[~!@#%^&|`?+*/<>=:-]/u.test(character)) {
      const start = offset;
      offset += 1;
      while (
        offset < value.length &&
        /[~!@#%^&|`?+*/<>=:-]/u.test(value[offset])
      ) {
        offset += 1;
      }
      tokens.push({ kind: "operator", value: value.slice(start, offset) });
      continue;
    }
    tokens.push({ kind: "literal", value: character });
    offset += 1;
  }
  return tokens;
}

function postgresDefinitionTree(value) {
  const root = { kind: "group", explicit: false, children: [] };
  const stack = [root];
  for (const token of postgresDefinitionTokens(value)) {
    if (token.kind !== "parenthesis") {
      stack.at(-1).children.push(token);
      continue;
    }
    if (token.value === "(") {
      const group = { kind: "group", explicit: true, children: [] };
      stack.at(-1).children.push(group);
      stack.push(group);
      continue;
    }
    if (stack.length === 1) {
      throw new Error("Postgres definition has an unmatched closing parenthesis");
    }
    stack.pop();
  }
  if (stack.length !== 1) {
    throw new Error("Postgres definition has an unmatched opening parenthesis");
  }
  return root;
}

function topLevelBooleanKind(group) {
  const words = group.children
    .filter(({ kind }) => kind === "word")
    .map(({ value }) => value.toUpperCase());
  if (words.some((word) => NON_ASSOCIATIVE_BOOLEAN_CONTEXT.has(word))) {
    return null;
  }
  const operators = new Set(
    words.filter((word) => BOOLEAN_DEFINITION_WORDS.has(word)),
  );
  return operators.size === 1 ? [...operators][0] : null;
}

function containsUnsafeSingletonSyntax(group) {
  return group.children.some(
    (child) =>
      (child.kind === "punctuation" && child.value === ",") ||
      (child.kind === "word" &&
        ["SELECT", "TABLE", "VALUES", "WITH"].includes(
          child.value.toUpperCase(),
        )),
  );
}

function booleanOperandAt(children, index, operator) {
  const previous = children[index - 1];
  const next = children[index + 1];
  const boundary = (value) =>
    value === undefined ||
    (value.kind === "word" && value.value.toUpperCase() === operator);
  return boundary(previous) && boundary(next);
}

function normalizePostgresDefinitionGroup(group) {
  for (const child of group.children) {
    if (child.kind === "group") normalizePostgresDefinitionGroup(child);
  }
  while (
    group.children.length === 1 &&
    group.children[0].kind === "group" &&
    topLevelBooleanKind(group.children[0]) !== null &&
    !containsUnsafeSingletonSyntax(group.children[0])
  ) {
    group.children = group.children[0].children;
  }
  let changed = true;
  while (changed) {
    changed = false;
    const operator = topLevelBooleanKind(group);
    if (!operator) break;
    const normalized = [];
    for (let index = 0; index < group.children.length; index += 1) {
      const child = group.children[index];
      if (
        child.kind === "group" &&
        topLevelBooleanKind(child) === operator &&
        booleanOperandAt(group.children, index, operator)
      ) {
        normalized.push(...child.children);
        changed = true;
      } else {
        normalized.push(child);
      }
    }
    group.children = normalized;
  }
  return group;
}

function serializedPostgresDefinitionNode(node) {
  if (node.kind !== "group") return [node.kind, node.value];
  return [
    node.explicit ? "group" : "root",
    ...node.children.map(serializedPostgresDefinitionNode),
  ];
}

export function canonicalizePostgresDefinition(value) {
  if (value === null) return null;
  return canonicalJson(
    serializedPostgresDefinitionNode(
      normalizePostgresDefinitionGroup(postgresDefinitionTree(value)),
    ),
  );
}

function portableDefinitionRows(rows, fields) {
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      fields.map((field) => [
        field,
        row[field] === null || row[field] === undefined
          ? row[field]
          : canonicalizePostgresDefinition(row[field]),
      ]),
    ),
  }));
}

function rawAclRows(rows) {
  return rows.map((row) => {
    const raw = { ...row };
    delete raw.grants_match_default;
    return raw;
  });
}

export function canonicalizePostgresAclRows(rows) {
  const seen = new Set();
  const canonicalRows = [];
  for (const captured of rows) {
    const { grants_match_default: grantsMatchDefault, ...raw } = captured;
    const row =
      grantsMatchDefault === true
        ? { ...raw, grants_are_default: true, grant_text: null }
        : raw;
    const key = canonicalJson(row);
    if (!seen.has(key)) {
      seen.add(key);
      canonicalRows.push(row);
    }
  }
  return canonicalRows;
}

export async function captureDatabaseManifest(
  sql,
  { schemas: requestedSchemas = BACKUP_SCHEMAS, profile } = {},
) {
  const schemas = Object.freeze([...requestedSchemas]);
  const moduleRecovery = moduleRecoveryProfile(profile, schemas);
  if (
    !moduleRecovery &&
    canonicalJson(schemas) !== canonicalJson(BACKUP_SCHEMAS) &&
    canonicalJson(schemas) !== canonicalJson(FINAL_BACKUP_SCHEMAS)
  ) {
    throw new Error("database manifest schema stage is invalid");
  }
  // JSON serialization of timestamptz follows the session timezone. Normalize
  // both the hosted source and isolated restore before hashing so identical
  // instants cannot fail verification solely because the hosts use different
  // timezone settings.
  await sql.unsafe("set timezone = 'UTC'").simple();
  const schemaInventory = await sql.unsafe(
    `
      select nspname
        from pg_catalog.pg_namespace
       where nspname = any($1::text[])
       order by nspname
    `,
    [moduleRecovery ? MODULE_MODE_BACKUP_SCHEMAS : FINAL_BACKUP_SCHEMAS],
  );
  if (
    canonicalJson(schemaInventory.map(({ nspname }) => nspname)) !==
      canonicalJson([...schemas].sort())
  ) {
    throw new Error("database manifest schema inventory is not exact");
  }
  const objects = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        class.relname as object_name,
        class.relkind::text as object_kind
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      where namespace.nspname = any($1::text[])
      order by namespace.nspname, class.relname, class.relkind
    `,
    [schemas],
  );
  const functions = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        procedure.proname as function_name,
        procedure.prokind::text as function_kind,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          as identity_arguments
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = any($1::text[])
      order by namespace.nspname, procedure.proname,
               pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    `,
    [schemas],
  );
  const types = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        type.typname as type_name,
        type.typtype::text as type_kind
      from pg_catalog.pg_type as type
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = type.typnamespace
      where namespace.nspname = any($1::text[])
        and type.typname not like '\\_%' escape '\\'
      order by namespace.nspname, type.typname
    `,
    [schemas],
  );
  const tables = objects.filter(({ object_kind: kind }) => ["p", "r"].includes(kind));
  if (moduleRecovery && (MODULE_RECOVERY_TABLES.some(name => !tables.some(table => table.schema_name === MODULE_MODE_BACKUP_SCHEMAS[0] && table.object_name === name))
    || !tables.some(table => table.schema_name === "supabase_migrations" && table.object_name === "schema_migrations"))) {
    throw new Error("Module recovery source schema is incomplete");
  }
  const [manifestIdentity] = await sql.unsafe(`
    select current_user::text as current_user,
           role_record.rolsuper
      from pg_catalog.pg_roles as role_record
     where role_record.rolname = current_user
  `);
  const restrictedPostgres =
    manifestIdentity?.current_user === "postgres" &&
    manifestIdentity?.rolsuper === false;
  if (moduleRecovery) {
    const [role] = await sql.unsafe("select current_user::text as role, rolsuper, rolbypassrls from pg_roles where rolname=current_user");
    if (role?.role !== "postgres" || (role.rolsuper !== true && role.rolbypassrls !== true)) {
      throw new Error("Module recovery requires complete owner reads through forced RLS");
    }
  }
  const relationOwners = restrictedPostgres
    ? await sql.unsafe(
        `
          select namespace.nspname as schema_name,
                 class.relname as relation_name,
                 pg_catalog.pg_get_userbyid(class.relowner) as relation_owner
            from pg_catalog.pg_class as class
            join pg_catalog.pg_namespace as namespace
              on namespace.oid = class.relnamespace
           where namespace.nspname = any($1::text[])
        `,
        [schemas],
      )
    : [];
  const ownerByRelation = new Map(
    relationOwners.map((row) => [
      `${row.schema_name}\0${row.relation_name}`,
      row.relation_owner,
    ]),
  );
  async function readAsRelationOwner(schemaName, relationName, operation) {
    if (!restrictedPostgres) return operation();
    const owner = ownerByRelation.get(`${schemaName}\0${relationName}`);
    if (!["postgres", "programmable_migrator"].includes(owner)) {
      throw new Error("database manifest relation owner is invalid");
    }
    if (owner === "postgres") return operation();
    await sql.unsafe("set role programmable_migrator").simple();
    try {
      return await operation();
    } finally {
      await sql.unsafe("set role postgres").simple();
    }
  }
  const tableEvidence = [];
  let totalRows = 0;
  for (const table of tables) {
    const schema = quoteIdentifier(table.schema_name);
    const name = quoteIdentifier(table.object_name);
    if (moduleRecovery) {
      const hash = createHash("sha256"), identities = createHash("sha256"), rawIntegerSums = {};
      let count = 0, exactRequestBytes = 0n;
      // One source request can contain 24 MiB. Stream one row instead of materializing a multi-GiB table.
      for await (const batch of sql.unsafe(`select pg_catalog.to_jsonb(row_value)::text as row_json
        from ${schema}.${name} as row_value order by pg_catalog.to_jsonb(row_value)::text collate "C"`).cursor(1)) {
        for (const row of batch) {
          if (typeof row.row_json !== "string") throw new Error("Module recovery row is invalid");
          const bytes = Buffer.from(row.row_json), length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length));
          hash.update(length).update(bytes); count++;
          const value = JSON.parse(row.row_json, (_key, value, context) => {
            if (typeof value !== "number") return value;
            if (typeof context?.source !== "string") throw new Error("Exact database number decoding requires Node 24");
            return context.source;
          });
          identities.update(canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => /(?:_id|_hash|_digest)$/u.test(key)))) + "\n");
          for (const [key, number] of Object.entries(value)) {
            if ((typeof number === "string" || typeof number === "number") && /^-?(?:0|[1-9][0-9]{0,127})$/u.test(String(number))) {
              rawIntegerSums[key] = (BigInt(rawIntegerSums[key] ?? "0") + BigInt(number)).toString();
            }
          }
          if (table.object_name === "module_source_drafts_v1") {
            if (typeof value.exact_request_bytes !== "string" || !/^\\x[0-9a-f]+$/u.test(value.exact_request_bytes)
              || value.exact_request_bytes.length % 2 !== 0) throw new Error("Module source bytes are unavailable");
            exactRequestBytes += BigInt((value.exact_request_bytes.length - 2) / 2);
          }
        }
      }
      totalRows += count;
      tableEvidence.push({ schema: table.schema_name, table: table.object_name, rows: count, rowsSha256: `0x${hash.digest("hex")}`,
        identitiesSha256: `0x${identities.digest("hex")}`, rawIntegerSums, ...(table.object_name === "module_source_drafts_v1" ? { exactRequestBytes: exactRequestBytes.toString() } : {}) });
      continue;
    }
    const rows = await readAsRelationOwner(
      table.schema_name,
      table.object_name,
      () => sql.unsafe(`
        select pg_catalog.to_jsonb(row_value)::text as row_json
        from ${schema}.${name} as row_value
        order by pg_catalog.to_jsonb(row_value)::text collate "C"
      `),
    );
    const hash = createHash("sha256");
    for (const row of rows) {
      const value = row?.row_json;
      if (typeof value !== "string") {
        throw new Error("database row manifest response is invalid");
      }
      const bytes = Buffer.from(value);
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(bytes.byteLength));
      hash.update(length);
      hash.update(bytes);
    }
    totalRows += rows.length;
    tableEvidence.push({
      schema: table.schema_name,
      table: table.object_name,
      rows: rows.length,
      rowsSha256: `0x${hash.digest("hex")}`,
    });
  }
  const payload = {
    schemas,
    objects,
    functions,
    types,
    tables: tableEvidence,
  };
  const schemaSecurity = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        pg_catalog.pg_get_userbyid(namespace.nspowner) as schema_owner,
        namespace.nspacl is null as grants_are_default,
        namespace.nspacl is null or
          namespace.nspacl = pg_catalog.acldefault('n', namespace.nspowner)
          as grants_match_default,
        grant_item.grant_text
      from pg_catalog.pg_namespace as namespace
      left join lateral (
        select acl_item::text as grant_text
        from pg_catalog.unnest(
          coalesce(namespace.nspacl, '{}'::aclitem[])
        ) as acl_item
        order by acl_item::text collate "C"
      ) as grant_item on true
      where namespace.nspname = any($1::text[])
      order by namespace.nspname,
               grant_item.grant_text collate "C" nulls first
    `,
    [schemas],
  );
  const relationSecurity = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        class.relname as relation_name,
        class.relkind::text as relation_kind,
        pg_catalog.pg_get_userbyid(class.relowner) as relation_owner,
        class.relrowsecurity as row_security_enabled,
        class.relforcerowsecurity as row_security_forced,
        class.relreplident::text as replica_identity,
        class.relpersistence::text as persistence,
        pg_catalog.pg_get_partkeydef(class.oid) as partition_key,
        pg_catalog.pg_get_expr(class.relpartbound, class.oid, true)
          as partition_bound,
        coalesce((
          select pg_catalog.array_agg(option_value order by option_value collate "C")
          from pg_catalog.unnest(class.reloptions) as option_value
        ), '{}'::text[])::text as relation_options,
        class.relacl is null as grants_are_default,
        class.relacl is null or
          case
            when class.relkind in ('r', 'p', 'v', 'm', 'f') then
              class.relacl = pg_catalog.acldefault('r', class.relowner)
            when class.relkind = 'S' then
              class.relacl = pg_catalog.acldefault('s', class.relowner)
            else false
          end as grants_match_default,
        grant_item.grant_text
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      left join lateral (
        select acl_item::text as grant_text
        from pg_catalog.unnest(
          coalesce(class.relacl, '{}'::aclitem[])
        ) as acl_item
        order by acl_item::text collate "C"
      ) as grant_item on true
      where namespace.nspname = any($1::text[])
      order by namespace.nspname, class.relname, class.relkind,
               grant_item.grant_text collate "C" nulls first
    `,
    [schemas],
  );
  const columns = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        class.relname as relation_name,
        attribute.attnum::integer as ordinal,
        attribute.attname as column_name,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          as data_type,
        attribute.attnotnull as not_null,
        attribute.attidentity::text as identity_kind,
        attribute.attgenerated::text as generated_kind,
        collation_namespace.nspname as collation_schema,
        collation_record.collname as collation_name,
        pg_catalog.pg_get_expr(
          attribute_default.adbin,
          attribute_default.adrelid,
          true
        ) as default_definition,
        attribute.attacl is null as grants_are_default,
        grant_item.grant_text
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as class
        on class.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      left join pg_catalog.pg_attrdef as attribute_default
        on attribute_default.adrelid = attribute.attrelid
       and attribute_default.adnum = attribute.attnum
      left join pg_catalog.pg_collation as collation_record
        on collation_record.oid = attribute.attcollation
       and attribute.attcollation <> 0
      left join pg_catalog.pg_namespace as collation_namespace
        on collation_namespace.oid = collation_record.collnamespace
      left join lateral (
        select acl_item::text as grant_text
        from pg_catalog.unnest(
          coalesce(attribute.attacl, '{}'::aclitem[])
        ) as acl_item
        order by acl_item::text collate "C"
      ) as grant_item on true
      where namespace.nspname = any($1::text[])
        and attribute.attnum > 0
        and not attribute.attisdropped
      order by namespace.nspname, class.relname, attribute.attnum,
               grant_item.grant_text collate "C" nulls first
    `,
    [schemas],
  );
  const functionDefinitions = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        procedure.proname as function_name,
        procedure.prokind::text as function_kind,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          as identity_arguments,
        pg_catalog.pg_get_function_result(procedure.oid) as result_type,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition,
        pg_catalog.pg_get_userbyid(procedure.proowner) as function_owner,
        procedure.prosecdef as security_definer,
        procedure.proleakproof as leakproof,
        procedure.provolatile::text as volatility,
        procedure.proparallel::text as parallel_safety,
        coalesce((
          select pg_catalog.array_agg(setting order by setting collate "C")
          from pg_catalog.unnest(procedure.proconfig) as setting
        ), '{}'::text[])::text as configuration,
        procedure.proacl is null as grants_are_default,
        grant_item.grant_text
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      left join lateral (
        select acl_item::text as grant_text
        from pg_catalog.unnest(
          coalesce(procedure.proacl, '{}'::aclitem[])
        ) as acl_item
        order by acl_item::text collate "C"
      ) as grant_item on true
      where namespace.nspname = any($1::text[])
        and procedure.prokind in ('f', 'p')
      order by namespace.nspname, procedure.proname,
               pg_catalog.pg_get_function_identity_arguments(procedure.oid),
               grant_item.grant_text collate "C" nulls first
    `,
    [schemas],
  );
  const views = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        class.relname as view_name,
        class.relkind::text as view_kind,
        pg_catalog.pg_get_viewdef(class.oid, false) as definition
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      where namespace.nspname = any($1::text[])
        and class.relkind in ('m', 'v')
      order by namespace.nspname, class.relname, class.relkind
    `,
    [schemas],
  );
  const constraints = await sql.unsafe(
    `
      select
        constraint_namespace.nspname as constraint_schema,
        constraint_record.conname as constraint_name,
        constraint_record.contype::text as constraint_kind,
        relation_namespace.nspname as relation_schema,
        relation.relname as relation_name,
        type_namespace.nspname as type_schema,
        type.typname as type_name,
        referenced_namespace.nspname as referenced_schema,
        referenced_relation.relname as referenced_relation,
        constraint_record.condeferrable as deferrable,
        constraint_record.condeferred as initially_deferred,
        constraint_record.convalidated as validated,
        constraint_record.connoinherit as no_inherit,
        pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
          as definition
      from pg_catalog.pg_constraint as constraint_record
      join pg_catalog.pg_namespace as constraint_namespace
        on constraint_namespace.oid = constraint_record.connamespace
      left join pg_catalog.pg_class as relation
        on relation.oid = constraint_record.conrelid
      left join pg_catalog.pg_namespace as relation_namespace
        on relation_namespace.oid = relation.relnamespace
      left join pg_catalog.pg_type as type
        on type.oid = constraint_record.contypid
      left join pg_catalog.pg_namespace as type_namespace
        on type_namespace.oid = type.typnamespace
      left join pg_catalog.pg_class as referenced_relation
        on referenced_relation.oid = constraint_record.confrelid
      left join pg_catalog.pg_namespace as referenced_namespace
        on referenced_namespace.oid = referenced_relation.relnamespace
      where constraint_namespace.nspname = any($1::text[])
         or relation_namespace.nspname = any($1::text[])
         or type_namespace.nspname = any($1::text[])
      order by constraint_namespace.nspname, constraint_record.conname,
               relation_namespace.nspname nulls first,
               relation.relname nulls first,
               type_namespace.nspname nulls first,
               type.typname nulls first
    `,
    [schemas],
  );
  const indexes = await sql.unsafe(
    `
      select
        table_namespace.nspname as table_schema,
        table_class.relname as table_name,
        index_namespace.nspname as index_schema,
        index_class.relname as index_name,
        index_record.indisunique as is_unique,
        index_record.indisprimary as is_primary,
        index_record.indisexclusion as is_exclusion,
        index_record.indimmediate as is_immediate,
        index_record.indisclustered as is_clustered,
        index_record.indisvalid as is_valid,
        index_record.indisready as is_ready,
        index_record.indislive as is_live,
        index_record.indisreplident as is_replica_identity,
        index_record.indnullsnotdistinct as nulls_not_distinct,
        pg_catalog.pg_get_indexdef(index_record.indexrelid, 0, true)
          as definition,
        coalesce((
          select pg_catalog.array_agg(option_value order by option_value collate "C")
          from pg_catalog.unnest(index_class.reloptions) as option_value
        ), '{}'::text[])::text as index_options
      from pg_catalog.pg_index as index_record
      join pg_catalog.pg_class as table_class
        on table_class.oid = index_record.indrelid
      join pg_catalog.pg_namespace as table_namespace
        on table_namespace.oid = table_class.relnamespace
      join pg_catalog.pg_class as index_class
        on index_class.oid = index_record.indexrelid
      join pg_catalog.pg_namespace as index_namespace
        on index_namespace.oid = index_class.relnamespace
      where table_namespace.nspname = any($1::text[])
      order by table_namespace.nspname, table_class.relname,
               index_namespace.nspname, index_class.relname
    `,
    [schemas],
  );
  const triggers = await sql.unsafe(
    `
      select
        relation_namespace.nspname as relation_schema,
        relation.relname as relation_name,
        trigger_record.tgname as trigger_name,
        trigger_record.tgenabled::text as enabled,
        procedure_namespace.nspname as function_schema,
        procedure.proname as function_name,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          as function_identity_arguments,
        pg_catalog.pg_get_triggerdef(trigger_record.oid, true) as definition
      from pg_catalog.pg_trigger as trigger_record
      join pg_catalog.pg_class as relation
        on relation.oid = trigger_record.tgrelid
      join pg_catalog.pg_namespace as relation_namespace
        on relation_namespace.oid = relation.relnamespace
      join pg_catalog.pg_proc as procedure
        on procedure.oid = trigger_record.tgfoid
      join pg_catalog.pg_namespace as procedure_namespace
        on procedure_namespace.oid = procedure.pronamespace
      where relation_namespace.nspname = any($1::text[])
        and not trigger_record.tgisinternal
      order by relation_namespace.nspname, relation.relname,
               trigger_record.tgname
    `,
    [schemas],
  );
  const policies = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        class.relname as relation_name,
        policy.polname as policy_name,
        policy.polcmd::text as command,
        policy.polpermissive as permissive,
        pg_catalog.array_to_string(array(
          select case
            when role_oid = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(role_oid)
          end
          from pg_catalog.unnest(policy.polroles) as role_oid
          order by case
            when role_oid = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(role_oid)
          end collate "C"
        ), E'\\n') as roles,
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, true)
          as using_expression,
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, true)
          as check_expression
      from pg_catalog.pg_policy as policy
      join pg_catalog.pg_class as class
        on class.oid = policy.polrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      where namespace.nspname = any($1::text[])
      order by namespace.nspname, class.relname, policy.polname
    `,
    [schemas],
  );
  const typeGrants = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        type.typname as type_name,
        type.typtype::text as type_kind,
        pg_catalog.pg_get_userbyid(type.typowner) as type_owner,
        type.typacl is null as grants_are_default,
        grant_item.grant_text
      from pg_catalog.pg_type as type
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = type.typnamespace
      left join lateral (
        select acl_item::text as grant_text
        from pg_catalog.unnest(
          coalesce(type.typacl, '{}'::aclitem[])
        ) as acl_item
        order by acl_item::text collate "C"
      ) as grant_item on true
      where namespace.nspname = any($1::text[])
        and type.typname not like '\\_%' escape '\\'
      order by namespace.nspname, type.typname,
               grant_item.grant_text collate "C" nulls first
    `,
    [schemas],
  );
  const enumDefinitions = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        type.typname as type_name,
        row_number() over (
          partition by type.oid
          order by enum_record.enumsortorder,
                   enum_record.enumlabel collate "C"
        )::integer as enum_ordinal,
        enum_record.enumlabel::text as enum_label
      from pg_catalog.pg_type as type
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = type.typnamespace
      join pg_catalog.pg_enum as enum_record
        on enum_record.enumtypid = type.oid
      where namespace.nspname = any($1::text[])
        and type.typtype = 'e'
      order by namespace.nspname, type.typname,
               enum_record.enumsortorder,
               enum_record.enumlabel collate "C"
    `,
    [schemas],
  );
  const domainDefinitions = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        type.typname as type_name,
        base_namespace.nspname as base_type_schema,
        base_type.typname as base_type_name,
        type.typtypmod::integer as base_type_modifier,
        type.typndims::integer as array_dimensions,
        type.typnotnull as not_null,
        coalesce(
          pg_catalog.pg_get_expr(type.typdefaultbin, 0, true),
          type.typdefault
        ) as default_definition,
        collation_namespace.nspname as collation_schema,
        collation_record.collname as collation_name
      from pg_catalog.pg_type as type
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = type.typnamespace
      join pg_catalog.pg_type as base_type
        on base_type.oid = type.typbasetype
      join pg_catalog.pg_namespace as base_namespace
        on base_namespace.oid = base_type.typnamespace
      left join pg_catalog.pg_collation as collation_record
        on collation_record.oid = type.typcollation
       and type.typcollation <> 0
      left join pg_catalog.pg_namespace as collation_namespace
        on collation_namespace.oid = collation_record.collnamespace
      where namespace.nspname = any($1::text[])
        and type.typtype = 'd'
      order by namespace.nspname, type.typname
    `,
    [schemas],
  );
  const rangeDefinitions = await sql.unsafe(
    `
      select
        range_namespace.nspname as range_type_schema,
        range_type.typname as range_type_name,
        multirange_namespace.nspname as multirange_type_schema,
        multirange_type.typname as multirange_type_name,
        subtype_namespace.nspname as subtype_schema,
        subtype.typname as subtype_name,
        operator_namespace.nspname as operator_class_schema,
        operator_class.opcname as operator_class_name,
        access_method.amname as operator_class_access_method,
        collation_namespace.nspname as collation_schema,
        collation_record.collname as collation_name,
        canonical_namespace.nspname as canonical_function_schema,
        canonical_function.proname as canonical_function_name,
        pg_catalog.pg_get_function_identity_arguments(canonical_function.oid)
          as canonical_function_identity_arguments,
        subdiff_namespace.nspname as subtype_diff_function_schema,
        subdiff_function.proname as subtype_diff_function_name,
        pg_catalog.pg_get_function_identity_arguments(subdiff_function.oid)
          as subtype_diff_function_identity_arguments
      from pg_catalog.pg_range as range_record
      join pg_catalog.pg_type as range_type
        on range_type.oid = range_record.rngtypid
      join pg_catalog.pg_namespace as range_namespace
        on range_namespace.oid = range_type.typnamespace
      left join pg_catalog.pg_type as multirange_type
        on multirange_type.oid = range_record.rngmultitypid
       and range_record.rngmultitypid <> 0
      left join pg_catalog.pg_namespace as multirange_namespace
        on multirange_namespace.oid = multirange_type.typnamespace
      join pg_catalog.pg_type as subtype
        on subtype.oid = range_record.rngsubtype
      join pg_catalog.pg_namespace as subtype_namespace
        on subtype_namespace.oid = subtype.typnamespace
      join pg_catalog.pg_opclass as operator_class
        on operator_class.oid = range_record.rngsubopc
      join pg_catalog.pg_namespace as operator_namespace
        on operator_namespace.oid = operator_class.opcnamespace
      join pg_catalog.pg_am as access_method
        on access_method.oid = operator_class.opcmethod
      left join pg_catalog.pg_collation as collation_record
        on collation_record.oid = range_record.rngcollation
       and range_record.rngcollation <> 0
      left join pg_catalog.pg_namespace as collation_namespace
        on collation_namespace.oid = collation_record.collnamespace
      left join pg_catalog.pg_proc as canonical_function
        on canonical_function.oid = range_record.rngcanonical
       and range_record.rngcanonical <> 0
      left join pg_catalog.pg_namespace as canonical_namespace
        on canonical_namespace.oid = canonical_function.pronamespace
      left join pg_catalog.pg_proc as subdiff_function
        on subdiff_function.oid = range_record.rngsubdiff
       and range_record.rngsubdiff <> 0
      left join pg_catalog.pg_namespace as subdiff_namespace
        on subdiff_namespace.oid = subdiff_function.pronamespace
      where range_namespace.nspname = any($1::text[])
      order by range_namespace.nspname, range_type.typname,
               multirange_namespace.nspname nulls first,
               multirange_type.typname nulls first
    `,
    [schemas],
  );
  const defaultPrivileges = await sql.unsafe(
    `
      select
        pg_catalog.pg_get_userbyid(default_acl.defaclrole) as role_name,
        namespace.nspname as schema_name,
        default_acl.defaclobjtype::text as object_kind,
        grant_item.grant_text
      from pg_catalog.pg_default_acl as default_acl
      left join pg_catalog.pg_namespace as namespace
        on namespace.oid = default_acl.defaclnamespace
      left join lateral (
        select acl_item::text as grant_text
        from pg_catalog.unnest(default_acl.defaclacl) as acl_item
        order by acl_item::text collate "C"
      ) as grant_item on true
      where namespace.nspname = any($1::text[])
         or (
           ${moduleRecovery ? "false and" : ""}
           default_acl.defaclnamespace = 0
           and pg_catalog.pg_get_userbyid(default_acl.defaclrole)
             = 'programmable_migrator'
         )
      order by pg_catalog.pg_get_userbyid(default_acl.defaclrole),
               namespace.nspname, default_acl.defaclobjtype,
               grant_item.grant_text collate "C" nulls first
    `,
    [schemas],
  );
  const sequenceDefinitions = await sql.unsafe(
    `
      select
        namespace.nspname as schema_name,
        class.relname as sequence_name,
        pg_catalog.format_type(sequence_record.seqtypid, null) as data_type,
        sequence_record.seqstart::text as start_value,
        sequence_record.seqincrement::text as increment_by,
        sequence_record.seqmax::text as maximum_value,
        sequence_record.seqmin::text as minimum_value,
        sequence_record.seqcache::text as cache_size,
        sequence_record.seqcycle as cycles,
        owner_namespace.nspname as owned_by_schema,
        owner_relation.relname as owned_by_relation,
        owner_attribute.attname as owned_by_column
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
      join pg_catalog.pg_sequence as sequence_record
        on sequence_record.seqrelid = class.oid
      left join pg_catalog.pg_depend as dependency
        on dependency.classid = 'pg_catalog.pg_class'::regclass
       and dependency.objid = class.oid
       and dependency.objsubid = 0
       and dependency.refclassid = 'pg_catalog.pg_class'::regclass
       and dependency.deptype in ('a', 'i')
      left join pg_catalog.pg_class as owner_relation
        on owner_relation.oid = dependency.refobjid
      left join pg_catalog.pg_namespace as owner_namespace
        on owner_namespace.oid = owner_relation.relnamespace
      left join pg_catalog.pg_attribute as owner_attribute
        on owner_attribute.attrelid = dependency.refobjid
       and owner_attribute.attnum = dependency.refobjsubid
      where namespace.nspname = any($1::text[])
      order by namespace.nspname, class.relname
    `,
    [schemas],
  );
  const sequences = [];
  for (const sequence of sequenceDefinitions) {
    const schema = quoteIdentifier(sequence.schema_name);
    const name = quoteIdentifier(sequence.sequence_name);
    const state = await readAsRelationOwner(
      sequence.schema_name,
      sequence.sequence_name,
      () => sql.unsafe(`
        select last_value::text as last_value, is_called
        from ${schema}.${name}
      `),
    );
    if (
      state.length !== 1 ||
      typeof state[0]?.last_value !== "string" ||
      typeof state[0]?.is_called !== "boolean"
    ) {
      throw new Error("database sequence manifest response is invalid");
    }
    sequences.push({
      ...sequence,
      lastValue: state[0].last_value,
      isCalled: state[0].is_called,
    });
  }
  const structuralPayload = {
    schemaVersion: 2,
    schemas,
    schemaSecurity: rawAclRows(schemaSecurity),
    relationSecurity: rawAclRows(relationSecurity),
    columns,
    functionDefinitions,
    views,
    constraints,
    indexes,
    triggers,
    policies,
    typeGrants,
    enumDefinitions,
    domainDefinitions,
    rangeDefinitions,
    defaultPrivileges,
    sequences,
  };
  const portableStructuralPayload = {
    ...structuralPayload,
    schemaVersion: 3,
    schemaSecurity: canonicalizePostgresAclRows(schemaSecurity),
    relationSecurity: canonicalizePostgresAclRows(relationSecurity),
    views: portableDefinitionRows(views, ["definition"]),
    constraints: constraints.map((row) =>
      row.constraint_kind === "c"
        ? portableDefinitionRows([row], ["definition"])[0]
        : row,
    ),
  };
  return Object.freeze({
    manifestSha256: sha256(canonicalJson(payload)),
    structuralManifestSha256: sha256(canonicalJson(structuralPayload)),
    portableStructuralManifestSha256: sha256(
      canonicalJson(portableStructuralPayload),
    ),
    tableCount: tables.length,
    rowCount: totalRows,
    ...(moduleRecovery ? { profile: MODULE_MODE_RECOVERY_PROFILE, tables: tableEvidence } : {}),
  });
}

async function openRestoreDatabase({ databaseUrl, sslCaPem, profile, safeTarget }) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete("sslmode");
  const sql = postgres(parsed.toString(), {
    ssl: profile === MODULE_MODE_RECOVERY_PROFILE ? moduleRestoreTlsOptions(sslCaPem, safeTarget.host) : { rejectUnauthorized: true, ca: sslCaPem },
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 5,
    max_lifetime: 60,
    onnotice: () => {},
    connection: {
      application_name: "programmable-isolated-restore-verifier",
    },
  });
  return { sql };
}

async function assertRestoreTargetIsEmpty(sql, safeTarget, profile, allowedRestoreDatabase = safeTarget.database) {
  const [identity] = await sql.unsafe(`
    select
      session_user::text as session_user,
      current_role::text as current_role,
      pg_catalog.current_database()::text as database_name,
      pg_catalog.inet_server_port()::integer as server_port,
      pg_catalog.pg_is_in_recovery() as in_recovery
  `);
  if (
    identity?.session_user !== "postgres" ||
    identity?.current_role !== "postgres" ||
    identity?.database_name !== safeTarget.database ||
    Number(identity?.server_port) !== safeTarget.port ||
    identity?.in_recovery !== false
  ) {
    throw new Error("isolated restore database identity is not approved");
  }
  const [footprint] = await sql.unsafe(
    `
      select
        (select pg_catalog.count(*)::integer
         from pg_catalog.pg_namespace
         where nspname = any($1::text[])) as schema_count,
        (select pg_catalog.count(*)::integer
         from pg_catalog.pg_class as class
         join pg_catalog.pg_namespace as namespace
           on namespace.oid = class.relnamespace
         where namespace.nspname = any($1::text[])) as object_count
    `,
    [BACKUP_SCHEMAS],
  );
  if (Number(footprint?.schema_count) !== 0 || Number(footprint?.object_count) !== 0) {
    throw new Error("isolated restore database is not empty");
  }
  if (profile === MODULE_MODE_RECOVERY_PROFILE) {
    const [isolation] = await sql.unsafe(`select host(inet_server_addr()) as server_address,
      (select rolsuper from pg_roles where rolname=current_user) as superuser,
      (select count(*)::integer from pg_database where datname not in ('template0','template1','postgres',$1)) as other_databases,
      (select count(*)::integer from pg_namespace where nspname not in ('pg_catalog','information_schema','public') and not starts_with(nspname,'pg_')) as extra_schemas,
      ((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
       + (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
       + (select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'))::integer as public_objects`, [allowedRestoreDatabase]);
    if (!["127.0.0.1", "::1"].includes(safeTarget.host) || !["127.0.0.1", "::1"].includes(isolation?.server_address)
      || isolation.superuser !== true || isolation.other_databases !== 0 || isolation.extra_schemas !== 0 || isolation.public_objects !== 0) {
      throw new Error("Module restore requires an empty dedicated local PostgreSQL cluster");
    }
  }
}

function pgVersion(stdout, expectedProgram) {
  const value = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout ?? "");
  const match = PG_TOOL_VERSION.exec(value);
  if (!match || Number(match[1]) !== 17 || (expectedProgram && !value.trim().startsWith(expectedProgram + " (PostgreSQL) "))) {
    throw new Error("Postgres 17 client tools are required");
  }
  return `PostgreSQL ${match[0]}`;
}

async function writeEvidence(request, evidence) {
  assertNoSecretOutput(evidence, [
    request.source.password,
    request.restore.password,
    request.sslCaPem,
    request.restoreSslCaPem,
    request.sourceDatabaseUrl,
    request.restoreDatabaseUrl,
  ].filter(Boolean));
  try {
    await createPrivateFile(
      request.evidencePath,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  } catch (error) {
    await rm(request.evidencePath, { force: true }).catch(() => {});
    throw error;
  }
}

function portableStructuralManifest(manifest) {
  const value =
    manifest?.portableStructuralManifestSha256 ??
    manifest?.structuralManifestSha256;
  if (!SHA256.test(value ?? "")) {
    throw new Error("portable database structure manifest is invalid");
  }
  return value;
}

export async function createBackupAndRestoreEvidence(input) {
  const request = validateBackupRequest(input);
  const moduleRecovery = request.profile === MODULE_MODE_RECOVERY_PROFILE;
  const started = performance.now();
  let restoreStarted, restoreElapsedMs, sourceWindowStart, sourceWindowEnd;
  let localRestore;
  const clientVersions = {};
  request.sourceDatabaseUrl = input.sourceDatabaseUrl;
  request.restoreDatabaseUrl = input.restoreDatabaseUrl;
  const dependencies = validateDependencies(input.dependencies, [
    "runCommand",
    "openHostedDatabase",
    "openRestoreDatabase",
    "closeHostedDatabase",
    "captureDatabaseManifest",
    "assertRestoreTargetIsEmpty",
    "inspectModuleRestore",
    "now",
  ]);
  const runner = dependencies.runCommand ?? runCommand;
  const openSource = dependencies.openHostedDatabase ?? openHostedDatabase;
  const openRestore = dependencies.openRestoreDatabase ?? openRestoreDatabase;
  const closeDatabase = dependencies.closeHostedDatabase ?? closeHostedDatabase;
  const captureManifest =
    dependencies.captureDatabaseManifest ?? captureDatabaseManifest;
  const assertRestoreEmpty =
    dependencies.assertRestoreTargetIsEmpty ?? assertRestoreTargetIsEmpty;
  const now = dependencies.now ?? (() => new Date());
  const inspectRestore = dependencies.inspectModuleRestore ?? inspectModuleRestore;
  const toolCommitments = input.toolCommitments;
  if (
    toolCommitments !== undefined &&
    (!isPlainRecord(toolCommitments) ||
      canonicalJson(Object.keys(toolCommitments).sort()) !==
        canonicalJson(["pg_dump", "pg_restore", "psql"]) ||
      Object.values(toolCommitments).some(
        (commitment) =>
          !isPlainRecord(commitment) ||
          !Number.isSafeInteger(commitment.bytes) ||
          commitment.bytes < 1 ||
          !SHA256.test(commitment.sha256 ?? ""),
      ))
  ) {
    throw new Error("Postgres tool commitments are invalid");
  }
  let sourceConnection;
  let restoreConnection;
  let postgresConnection;
  let sourceCa;
  let restoreCa;
  let backupCreated = false;
  try {
    const existing = await readIdempotentEvidence(request);
    if (existing) return existing;
    sourceCa = await createTemporaryCa(request.sslCaPem);
    restoreCa = await createTemporaryCa(request.restoreSslCaPem);
    if (moduleRecovery) await inspectRestore(request.restoreBinding, request.restore.safeTarget, request.restoreSslCaPem);
    if (!moduleRecovery) sourceConnection = await openSource({
      databaseUrl: input.sourceDatabaseUrl,
      expectedProjectRef: input.expectedProjectRef,
      sslCaPem: request.sslCaPem,
    });
    restoreConnection = await openRestore({
      databaseUrl: input.restoreDatabaseUrl,
      sslCaPem: request.restoreSslCaPem,
      safeTarget: request.restore.safeTarget,
      ...(moduleRecovery ? { profile: request.profile } : {}),
    });
    const inspectConnectedRestore = async () => {
      if (!moduleRecovery) return;
      const result = await inspectRestore(request.restoreBinding, request.restore.safeTarget, request.restoreSslCaPem, { sql: restoreConnection.sql });
      const { dataDirectory, postgres, pgControlData, postmasterPid, systemIdentifier, ...observation } = result;
      localRestore = { binding: { dataDirectory, postgres, pgControlData, postmasterPid, systemIdentifier }, ...observation, postgresDatabaseEmpty: true };
    };
    await inspectConnectedRestore();
    await assertRestoreEmpty(restoreConnection.sql, request.restore.safeTarget, request.profile);
    if (moduleRecovery) {
      const postgresUrl = new URL(input.restoreDatabaseUrl); postgresUrl.pathname = "/postgres";
      const postgresTarget = { ...request.restore.safeTarget, database: "postgres" };
      postgresConnection = await openRestore({ databaseUrl: postgresUrl.toString(), sslCaPem: request.restoreSslCaPem,
        safeTarget: postgresTarget, profile: request.profile });
      await inspectRestore(request.restoreBinding, postgresTarget, request.restoreSslCaPem, { sql: postgresConnection.sql });
      await assertRestoreEmpty(postgresConnection.sql, postgresTarget, request.profile, request.restore.safeTarget.database);
      await closeDatabase(postgresConnection.sql); postgresConnection = undefined;
      sourceConnection = await openSource({ databaseUrl: input.sourceDatabaseUrl,
        expectedProjectRef: input.expectedProjectRef, sslCaPem: request.sslCaPem });
      await sourceConnection.sql.unsafe("set default_transaction_read_only = on").simple();
      sourceWindowStart = now().toISOString();
    }
    const before = await captureManifest(sourceConnection.sql, {
      schemas: request.schemas,
      ...(moduleRecovery ? { profile: request.profile } : {}),
    });
    if (
      !SHA256.test(before?.manifestSha256 ?? "") ||
      !SHA256.test(before?.structuralManifestSha256 ?? "") ||
      !SHA256.test(portableStructuralManifest(before)) ||
      !Number.isSafeInteger(before?.tableCount) ||
      before.tableCount < 0 ||
      !Number.isSafeInteger(before?.rowCount) ||
      before.rowCount < 0
    ) {
      throw new Error("source database manifest is invalid");
    }
    const secrets = [
      request.source.password,
      request.restore.password,
      input.sourceDatabaseUrl,
      input.restoreDatabaseUrl,
      request.sslCaPem,
      request.restoreSslCaPem,
    ];
    const sourceEnvironment = safeChildEnvironment({
      password: request.source.password,
      caPath: sourceCa.filePath,
      applicationName: "programmable-pg-backup",
    });
    if (moduleRecovery) sourceEnvironment.PGOPTIONS = "-c default_transaction_read_only=on";
    const restoreEnvironment = safeChildEnvironment({
      password: request.restore.password,
      caPath: restoreCa.filePath,
      applicationName: "programmable-pg-restore-test",
    });
    if (toolCommitments !== undefined) {
      delete sourceEnvironment.PATH;
      delete restoreEnvironment.PATH;
    }
    const versionResult = await executeSafeCommand({
      runner,
      binary: input.pgDumpBinary ?? "pg_dump",
      args: ["--version"],
      env: sourceEnvironment,
      timeoutMs: 15_000,
      secrets,
      expectedBinary: toolCommitments?.pg_dump,
    });
    const postgresVersion = pgVersion(versionResult.stdout, moduleRecovery ? "pg_dump" : undefined);
    if (moduleRecovery) {
      clientVersions.pg_dump = postgresVersion;
      for (const [program, binary] of [["pg_restore", input.pgRestoreBinary ?? "pg_restore"], ["psql", input.psqlBinary ?? "psql"]]) {
        const result = await executeSafeCommand({ runner, binary, args: ["--version"], env: restoreEnvironment,
          timeoutMs: 15_000, secrets, expectedBinary: toolCommitments?.[program] });
        clientVersions[program] = pgVersion(result.stdout, program);
      }
    }
    let backupFormat;
    let listResult;
    if (before.tableCount === 0 && before.rowCount === 0) {
      backupFormat = "empty-target-schemas-v1";
      const emptyArtifact = `${canonicalJson({
        kind: backupFormat,
        schemaVersion: 1,
        sourceManifestSha256: before.manifestSha256,
        sourceStructuralManifestSha256: before.structuralManifestSha256,
        sourcePortableStructuralManifestSha256:
          portableStructuralManifest(before),
      })}\n`;
      await createPrivateFile(request.backupPath, emptyArtifact);
      backupCreated = true;
      listResult = {
        stdout: Buffer.from(emptyArtifact),
        stderr: Buffer.alloc(0),
      };
    } else {
      backupFormat = "pg-custom-v1";
      await createPrivateFile(request.backupPath);
      backupCreated = true;
      const dumpArguments = [
        "--format=custom",
        "--compress=6",
        "--serializable-deferrable",
        ...(request.source.username === "cli_login_postgres"
          ? ["--role", "postgres"]
          : []),
        ...request.schemas.flatMap((schema) => ["--schema", schema]),
        ...commandTargetArguments(request.source.safeTarget, request.source.username),
        "--file",
        request.backupPath,
      ];
      await executeSafeCommand({
        runner,
        binary: input.pgDumpBinary ?? "pg_dump",
        args: dumpArguments,
        env: sourceEnvironment,
        timeoutMs: 15 * 60_000,
        secrets,
        expectedBinary: toolCommitments?.pg_dump,
      });
      await chmod(request.backupPath, 0o600);
      if (moduleRecovery) {
        const file = await open(request.backupPath, "r+"), directory = await open(path.dirname(request.backupPath), "r");
        try { await file.sync(); await directory.sync(); } finally { await file.close(); await directory.close(); }
      }
    }
    const after = await captureManifest(sourceConnection.sql, {
      schemas: request.schemas,
      ...(moduleRecovery ? { profile: request.profile } : {}),
    });
    if (moduleRecovery) sourceWindowEnd = now().toISOString();
    if (
      after?.manifestSha256 !== before.manifestSha256 ||
      after?.structuralManifestSha256 !== before.structuralManifestSha256 ||
      portableStructuralManifest(after) !== portableStructuralManifest(before) ||
      after?.tableCount !== before.tableCount ||
      after?.rowCount !== before.rowCount
    ) {
      throw new Error("source database changed during the backup window");
    }
    if (backupFormat === "pg-custom-v1") {
      const backupBeforeList = await fileSha256(request.backupPath);
      listResult = await executeSafeCommand({
        runner,
        binary: input.pgRestoreBinary ?? "pg_restore",
        args: ["--list", request.backupPath],
        env: sourceEnvironment,
        timeoutMs: 60_000,
        secrets,
        expectedBinary: toolCommitments?.pg_restore,
      });
      const backupAfterList = await fileSha256(request.backupPath);
      if (canonicalJson(backupAfterList) !== canonicalJson(backupBeforeList)) {
        throw new Error("Postgres backup changed during archive inspection");
      }
    }
    if (listResult.stdout.byteLength < 1) {
      throw new Error("Postgres backup archive listing is empty");
    }
    if (backupFormat === "pg-custom-v1") {
      restoreStarted = performance.now();
      await inspectConnectedRestore();
      await executeSafeCommand({
        runner,
        binary: input.psqlBinary ?? "psql",
        args: [
          "--no-psqlrc",
          "--quiet",
          "--set",
          "ON_ERROR_STOP=1",
          ...commandTargetArguments(request.restore.safeTarget, request.restore.username),
          "--command",
          roleBootstrapSql(request.profile),
        ],
        env: restoreEnvironment,
          timeoutMs: 60_000,
          secrets,
          expectedBinary: toolCommitments?.psql,
        });
      await inspectConnectedRestore();
      const backupBeforeRestore = await fileSha256(request.backupPath);
      await executeSafeCommand({
        runner,
        binary: input.pgRestoreBinary ?? "pg_restore",
        args: [
          "--exit-on-error",
          "--single-transaction",
          ...commandTargetArguments(request.restore.safeTarget, request.restore.username),
          request.backupPath,
        ],
        env: restoreEnvironment,
          timeoutMs: 15 * 60_000,
          secrets,
          expectedBinary: toolCommitments?.pg_restore,
        });
      await inspectConnectedRestore();
      const backupAfterRestore = await fileSha256(request.backupPath);
      if (canonicalJson(backupAfterRestore) !== canonicalJson(backupBeforeRestore)) {
        throw new Error("Postgres backup changed during isolated restore");
      }
    }
    const restored = await captureManifest(restoreConnection.sql, {
      schemas: request.schemas,
      ...(moduleRecovery ? { profile: request.profile } : {}),
    });
    if (moduleRecovery) restoreElapsedMs = performance.now() - restoreStarted;
    if (
      restored?.manifestSha256 !== before.manifestSha256 ||
      !SHA256.test(restored?.structuralManifestSha256 ?? "") ||
      portableStructuralManifest(restored) !==
        portableStructuralManifest(before) ||
      restored?.tableCount !== before.tableCount ||
      restored?.rowCount !== before.rowCount
    ) {
      throw new Error("isolated restore does not match the source manifest");
    }
    const backup = await fileSha256(request.backupPath);
    if (backup.bytes < 1) throw new Error("Postgres backup archive is empty");
    const createdAt = now();
    if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
      throw new Error("backup evidence timestamp is invalid");
    }
    const evidence = Object.freeze({
      kind: "programmable-database-backup-restore-evidence",
      schemaVersion: 1,
      operationId: request.operationId,
      repositoryCommit: request.repositoryCommit,
      requestSha256: request.requestSha256,
      source: request.source.safeTarget,
      restore: request.restore.safeTarget,
      schemas: request.schemas,
      backup: Object.freeze({
        format: backupFormat,
        sha256: backup.sha256,
        bytes: backup.bytes,
        archiveListSha256: sha256(listResult.stdout),
      }),
      sourceManifestSha256: before.manifestSha256,
      restoredManifestSha256: restored.manifestSha256,
      sourceStructuralManifestSha256: before.structuralManifestSha256,
      restoredStructuralManifestSha256: restored.structuralManifestSha256,
      sourcePortableStructuralManifestSha256:
        portableStructuralManifest(before),
      restoredPortableStructuralManifestSha256:
        portableStructuralManifest(restored),
      tableCount: before.tableCount,
      rowCount: before.rowCount,
      postgresVersion,
      ...(moduleRecovery ? { moduleRecovery: {
        profile: request.profile, source: before, restored,
        localRestore, clientVersions,
        sourceCaptureWindow: { startedAt: sourceWindowStart, finishedAt: sourceWindowEnd },
        restoreElapsedMs, totalElapsedMs: performance.now() - started,
        productionRestorePerformed: false, independentArchiveCopies: "unavailable", rpo: "unavailable",
      } } : {}),
      createdAt: createdAt.toISOString(),
    });
    if (moduleRecovery) validateModuleRecoveryDatabaseEvidence(evidence);
    await writeEvidence(request, evidence);
    return Object.freeze({
      kind: "programmable-database-backup-restore-result",
      schemaVersion: 1,
      status: "created",
      changed: true,
      evidence,
    });
  } catch (error) {
    if (backupCreated && !moduleRecovery) {
      await rm(request.backupPath, { force: true }).catch(() => {});
    }
    throw operationalFailure("database backup and isolated restore", error);
  } finally {
    if (sourceConnection?.sql) await closeDatabase(sourceConnection.sql).catch(() => {});
    if (restoreConnection?.sql) await closeDatabase(restoreConnection.sql).catch(() => {});
    if (postgresConnection?.sql) await closeDatabase(postgresConnection.sql).catch(() => {});
    if (sourceCa?.directory) {
      await rm(sourceCa.directory, { recursive: true, force: true }).catch(() => {});
    }
    if (restoreCa?.directory) {
      await rm(restoreCa.directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
