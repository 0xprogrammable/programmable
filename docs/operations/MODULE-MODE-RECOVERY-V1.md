# Module Mode recovery v1

`scripts/module-mode-recovery-v1.mjs` captures the current Module API database,
restores that dump into a dedicated local PostgreSQL cluster, and checks a supplied
private Robinhood index snapshot against the existing canonical source verifiers.
It uses `createBackupAndRestoreEvidence` and `captureDatabaseManifest` from
`scripts/data-pipeline/cutover-credentials.mjs`. The historical schema defaults and
the retired Candidate cutover CLI remain unchanged.

The explicit profile is `programmable.module-mode-recovery.v1`. Its schemas are
exactly `programmable_custom_launch_api_v1` and `supabase_migrations`. Capturing
the whole API schema preserves source bytes, principal/wallet/credential bindings,
scope and revocation state, request identities, review plans/artifacts/attempts/
decisions, existing launch state and the migration history together. It does not
apply or replay a migration.

## Preconditions and authority

Use a clean checkout at the reviewed full product commit with its lockfile
dependencies and Node 24. The operator verifies that commit and clean state both
before capture and before publishing its local result. It never executes source
or binaries from a contribution archive. The canonical index parser and verifiers
are compiled from this checkout with the lockfile-pinned esbuild; their exact bundle
digest is recorded.

The source must be the explicit, independently identified Supabase project in the
configuration. The existing connector requires its direct
`db.<project-ref>.supabase.co:5432/postgres` endpoint with verified TLS, an exact
`postgres` session or the existing `cli_login_postgres` membership/SET ROLE path.
Module reads require an effective owner able to read through forced RLS. The
source session and `pg_dump` set `default_transaction_read_only=on`. No source
SQL mutation, migration, credential rotation or provider configuration is exposed.

The only database mutation target is
`programmable_restore_<restoreIsolationId>` on literal `127.0.0.1` or `::1`, with
an explicit port and `sslmode=verify-full`. The operator must have started this
new disposable PostgreSQL 17 cluster and supplied its exact `restoreBinding`.
The verifier binds its private canonical data directory, `postmaster.pid`,
postmaster PID and executable, pinned `postgres`/`pg_controldata` bytes and control
system identifier. OS inspection must show that this postmaster owns the sole
loopback TCP listener on that port. The connected SQL backend must be its child
and must report the same directory, control identifier, startup time, TLS files
and PostgreSQL 17 server version. A loopback URL and a reported loopback server
address alone do not prove isolation. Linux uses `/proc/<pid>/exe`, `/bin/ps` and
`/usr/bin/lsof`; macOS uses `/bin/ps` and `/usr/sbin/lsof`. Missing inspection tools
or any other platform fail closed.

The local TLS trust input must contain exactly one currently valid, self-signed
certificate with `CA:false`, identical to the cluster's `server.crt`. Its private
key is the cluster's own `server.key`; both files and `postmaster.pid` must be
private regular `0600` files in the operator-owned `0700` data directory. SQL must
report these exact relative TLS filenames. Every Node connection additionally
pins the exact certificate DER and verifies the host. Every new `psql` and
`pg_restore` connection uses this single leaf with libpq `verify-full`; additional
CA certificates and fallback trust stores are not accepted. The local identity is
rechecked immediately before and after those mutations. A substituted listener
cannot authenticate with a different certificate, even when the earlier SQL
connection remains open.

Only the target, `postgres`, `template0` and `template1` may exist, including
databases marked as templates. The target and a separately authenticated
connection to `postgres` must both contain no application schema or public object.
The server must report a `postgres` superuser. Provisioning the disposable cluster,
its binaries and private TLS leaf is an operator prerequisite; this command does
not provision a service or modify an existing shared cluster.

`pg_dump`, `pg_restore` and `psql` must be explicit canonical files with known byte
counts and SHA-256 commitments. The existing helper checks each commitment before
execution and requires PostgreSQL 17 client tools. Restore uses
`--exit-on-error --single-transaction`, preserves schema ownership/ACLs/RLS, and
creates only the required inert local role names. Existing roles must already be
nonprivileged `NOLOGIN` roles with no membership edges. Production passwords are
never restored or included in receipts.
All three client versions and the connected server version are checked separately
and recorded together with the local process and certificate binding.

## Inputs

The capture configuration is a private regular `0400` or `0600` JSON file.
All paths are absolute canonical paths without symlinks. Secret files use the same
private modes. Tool files may belong to the operator or root; other inputs belong
to the operator and may not be writable by group or others. The new output
directory is created with `0700`; outputs are exclusive `0600` files with fsync.

Required configuration keys:

| Key | Actual operator input |
| --- | --- |
| `schemaVersion` | `programmable.module-mode-recovery-config.v1` |
| `operationId` | One 8–64 character lowercase operation identity |
| `repositoryCommit` | Exact clean 40-character source commit |
| `expectedSourceProjectRef` | Independently verified 20-character project ref |
| `sourceDatabaseUrlFile`, `sourceCaFile` | Existing owner/JIT URL and verified source CA custody files |
| `restoreIsolationId` | 8–32 character identifier of the dedicated local target |
| `restoreDatabaseUrlFile`, `restoreCaFile` | Local target URL and the single local TLS leaf custody files |
| `restoreBinding` | Exactly `{dataDirectory, postmasterPid, systemIdentifier, postgres, pgControlData}`; `systemIdentifier` is the decimal control-system ID, each binary is `{file, bytes, sha256}` |
| `blobFile`, `blobEtag`, `blobBytes`, `blobSha256` | Actual bytes and original quoted ETag of `website-index/robinhood/launches-v1.json`, maximum 16 MiB |
| `backendBaseUrl`, `websiteTokenFile` | Existing HTTPS Module collector origin and server credential custody file |
| `tools` | Exactly `pg_dump`, `pg_restore`, `psql`, each `{file, bytes, sha256}` |
| `archiveFiles` | 8–32 distinct `{kind, file, bytes, sha256}` entries, maximum 512 MiB each and 2 GiB total |

`archiveFiles` must include the actual retained `source`, `compiler`, `dependencies`,
`abi`, `review`, `deployment`, `lifecycle`, and `operator` artifacts. Use existing
sealed packages and evidence. Their bytes are copied and rehashed; labels and
hashes alone do not prove a complete source/dependency/license closure or an
independent storage provider. Do not supply placeholders or reconstruct missing
evidence by inventing values. Missing files, an absent/null index bootstrap,
missing source lanes or an unavailable authorized release stop capture.

The supplied Blob file is explicitly recorded as an operator-provided file. Its
ETag is a custody binding, not a claim that this command downloaded or authenticated
that Blob version. The command does not read any Blob write token and never writes
to the live store.

## Capture and isolated restore

The following variables contain only private file/directory paths and the local
isolation ID; never pass a database URL, password, CA contents or service token
as a CLI argument.

```sh
node scripts/module-mode-recovery-v1.mjs capture \
  --config-file "$module_recovery_config_file" \
  --output-directory "$module_recovery_new_directory" \
  --confirm-isolated-target "RESTORE ONLY programmable_restore_$module_recovery_isolation_id"
```

Index verification uses the existing Custom source and authenticated Module
collector. It requires the installed release inventory to match the saved lanes,
re-verifies every recorded launch block with the actual source normalizer, then
runs the existing bounded replay/CAS implementation against an in-memory local
store through each recorded cutoff. Existing verified markets must be independently
provable; a temporarily missing positive market proof cannot pass this recovery
check. Previously marketless launches can receive a newly verified market. Source
identity, receipt, block, release, permission or finality disagreement fails closed.
The budget is at most 256 distinct launch blocks and five minutes for point checks,
plus the existing bounded replay per lane. There is no unbounded backfill or new
RPC quorum implementation.

The database helper opens one `READ ONLY REPEATABLE READ` source transaction and
exports its PostgreSQL snapshot. Both source manifests and `pg_dump --snapshot`
use that same snapshot. It verifies the exporter PID, session/effective role,
database, server major, transaction timestamp, isolation and transaction snapshot
before and after the dump. The evidence binds the actual export time, source,
schema manifest and migration versions/names/statement hashes. An application
write committed after that cutoff is outside this backup, including a later
migration or credential revocation; ongoing traffic need not stop.

The exporter is rolled back as soon as the matching source manifests and dump are
captured, before local restore begins. A successful proof requires the server's
`ROLLBACK` acknowledgement. The error path also attempts rollback and closes the
connection. Source queries have a two-minute statement timeout and two-second
lock timeout, idle transactions expire after two minutes, and the source
transaction is capped at ten minutes. The Module dump process is capped at five
minutes with a two-second lock-acquisition timeout; rollback acknowledgement is
bounded to ten seconds. These settings affect only the recovery sessions. No
replication slot, production freeze, write fence or source mutation is created.

The database helper compares the two source manifests within that shared snapshot.
It restores into the inspected local target and compares the restored rows and
portable structural catalog. Module table rows stream one at a time, including
exact bytea request bytes. Every table records row count, row/identity hashes and
raw integer column sums. Large JSON numbers are decoded from their original text;
these sums never pass through floating-point arithmetic. The source table also
records its exact request-byte total. The sums are labeled by table and column;
they are not represented as financial balances without an asset/unit authority.

Successful output contains only the status and the manifest SHA-256. The private
directory retains the attempted operation, actual `database.dump`, database
evidence, original and replayed index bytes, archive byte copies, and manifest.
The manifest binds schemas, source/decoder/contract identities, checkpoint/cutoff
hashes, finality policies, byte hashes, counts, raw sums and measured local restore/
replay durations. Later verification of a copied capsule uses the independently
retained digest from the successful capture:

```sh
node scripts/module-mode-recovery-v1.mjs verify \
  --directory "$module_recovery_existing_directory" \
  --expected-manifest-sha256 "$module_recovery_manifest_sha256"
```

This verification reads only local files and checks their commitments, the exact
decoder and index shapes. It does not repeat the database restore or refresh
provider evidence. A failure preserves available artifacts and writes a fixed
error code. It never reports success or activation. Inspect the preserved attempt,
dump and local target before using a different operation; there is no cleanup,
production restore, live Blob overwrite or automatic retry command.

## Evidence limits and production handoff

The database and Blob capture are separate observations, not a cross-provider
transaction. The exported database transaction snapshot, capture times and
source-specific chain cutoffs are explicit.
The receipt attests the isolated restore and canonical replay it actually ran.
It records end-to-end disaster RTO, RPO, independent archive copies and onchain
asset/claim balances as **unavailable**. The API and index are not the onchain
fee ledger. Binding lifecycle files does not turn them into a fresh complete
balance/claim reconciliation.

Before production recovery or D08 activation, the responsible operator must supply
the current provider backup/PITR recovery window, independently retained archive
copies, acknowledged-operation cutoff and later revocations, and actual onchain
balance/claim reconciliation where required. Measure the complete recovery through
that cutoff and use existing maintenance/fencing authority. Old backed-up access
must not be reenabled; this local cluster's runtime roles remain `NOLOGIN`.
No RPO/RTO, archive quorum, ongoing storage funding or activation authority is
created by this command.

Local verification:

```sh
node --test scripts/test/module-mode-recovery-v1.test.mjs \
  scripts/data-pipeline/cutover-credentials.test.mjs
```

The tests include an actual PGlite data-archive round trip with source bytes,
revocation and review data, large integer accounting, target-isolation negatives,
source drift, secret-free process arguments and actual shared Engine source replay.
Isolation regressions include a remote-loopback tunnel listener, foreign SQL PID
lineage, application objects in `postgres`, a different client/server major and a
different or multiple TLS leaf. A real native-runtime check must additionally
demonstrate libpq acceptance of the local `CA:false` leaf and rejection of another
leaf before using that runtime for a recovery drill.
Mocked process tests are labeled as orchestration tests; they do not attest a
native PostgreSQL or hosted provider drill. These tests run in the existing
`test:database-runtime:ci` command after its existing projection-target suite;
no separate recovery workflow or authority is introduced.
