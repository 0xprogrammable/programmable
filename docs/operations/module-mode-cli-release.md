# Module Mode standalone CLI

The contributor download is one bundled `.mjs` file for Node.js `>=24.14.0 <25`.
It requires neither an npm installation nor a clone of the product repository.
The SDK entry is `packages/classic-modules/bin/programmable-classic-modules.mjs`;
its package version names the distribution. The SDK remains private and is not
published to npm by this workflow.

## First use after website publication

The versioned paths below are source-prepared artifacts. They become public only
after the reviewed website commit is promoted. Do not advertise a live download
from local generation alone.

Download into a new directory, verify the bytes, then run the file:

```sh
set -eu
mkdir programmable-module-cli
cd programmable-module-cli
module_cli_base='https://programmable.market/developers/module-mode-cli/v1.0.0-development.1'
curl --fail --proto '=https' --tlsv1.2 --output programmable-module-mode-1.0.0-development.1.mjs "$module_cli_base/programmable-module-mode-1.0.0-development.1.mjs"
curl --fail --proto '=https' --tlsv1.2 --output SHA256SUMS "$module_cli_base/SHA256SUMS"
curl --fail --proto '=https' --tlsv1.2 --output LICENSES.txt "$module_cli_base/LICENSES.txt"
curl --fail --proto '=https' --tlsv1.2 --output manifest.json "$module_cli_base/manifest.json"
shasum -a 256 -c SHA256SUMS
node programmable-module-mode-1.0.0-development.1.mjs --version
node programmable-module-mode-1.0.0-development.1.mjs --help
```

On Linux, `sha256sum -c SHA256SUMS` is equivalent. The manifest names the exact
artifact bytes, SHA-256, source inputs, dependency lock coordinates and runtime
builtins. These are content bindings, not a digital signature, independent
review, module approval or deployment proof. Fetch the expected checksum from
the trusted versioned product release; a checksum from an arbitrary mirror is
not an identity proof.

The CLI requires an explicit API origin for network commands and reads module
credentials only from `PROGRAMMABLE_MODULES_API_KEY`. A key never grants review,
launch, signing or broadcast authority. The client's current help and
`packages/classic-modules/MODULE-API.md` describe source preparation, live
capability checks, submission and status. An intake receipt such as
`draft_received` is distinct from approval and catalog availability.

## Prepare and verify an artifact

Use the existing locked development dependencies. The builder uses the installed
esbuild version pinned in `package-lock.json`; it does not install dependencies
or fetch source. A controlled dependency symlink is supported when it points to
the identical installed lock. Build only in a trusted checkout without another
process mutating source or dependencies; this is not a build sandbox.

```sh
node scripts/build-module-cli.mjs --write
node scripts/build-module-cli.mjs
node --test scripts/test/module-cli-distribution.test.mjs
```

The first command creates missing artifact files exclusively. The default command
rebuilds in memory and compares exact bytes without modifying files. Neither
command overwrites differing artifacts. Stage and commit the exact generated
version directory only after checks pass.

The CLI source directories, SDK package metadata, lock and build script must be
committed before generation. Staged changes, unstaged changes and untracked
candidate source are rejected. The actual project input bytes are also compared
with Git blobs, so an index hint such as `assume-unchanged` cannot hide drift.
Unrelated website edits do not enter this source digest; the integration owner
still requires a clean final release checkout.

The source digest includes the source inputs retained in the bundle, dependency metadata and
license texts, package version, build settings, lock bytes and builder source.
It contains no Git HEAD, generation timestamp, local absolute path or secret.
Committing the generated artifact therefore does not create a source-hash cycle.
The same sources rebuild across different checkout directories.

Only Node builtins may remain external. The bundled executable is capped at
1 MiB. Third-party license texts are included in the accompanying `LICENSES.txt`
and are also bound by the manifest. The local smoke copies only the executable
into an isolated directory and runs it without `node_modules` or API credentials.

## Version and release boundary

Once a version manifest is committed, the builder rejects different source or
artifact bytes at that version. For a new CLI change, update
`packages/classic-modules/package.json` to a new prerelease or release version,
commit the source, then generate a new directory. Keep existing versioned files.
Update the public instructions to the new exact version after verification.

The builder cannot stop a separate operator from deleting history or directly
editing a deployed file. The source gate must run in CI, and website promotion
must bind the reviewed commit. This prepared distribution has no invented
immutable-host guarantee or signing authority.

Suggested root scripts for the integration owner:

```json
{
  "module-cli:build": "node scripts/build-module-cli.mjs --write",
  "module-cli:check": "node scripts/build-module-cli.mjs",
  "module-cli:test": "node --test scripts/test/module-cli-distribution.test.mjs"
}
```

After owner-authorized publication, retrieve the exact public manifest and
download on a clean machine, verify the checksum, run `--help`, and probe the
explicit live module capabilities. A public CLI download does not by itself prove
that module submissions or a Module Mode contract are live.
