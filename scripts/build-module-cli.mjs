#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

export const MODULE_CLI_RELEASE_SCHEMA = 'programmable.module-cli-distribution.v1';
export const MODULE_CLI_RELEASE_ROOT = 'public/developers/module-mode-cli';
export const MODULE_CLI_SOURCE_PATHS = Object.freeze([
  'packages/classic-modules/bin', 'packages/classic-modules/src',
  'packages/classic-modules/schemas', 'packages/classic-modules/package.json',
  'package-lock.json', 'scripts/build-module-cli.mjs',
]);
const ENTRY = 'packages/classic-modules/bin/programmable-classic-modules.mjs';
const MINIMUM_NODE = '24.14.0';
const MAXIMUM_BUNDLE_BYTES = 1_048_576;
const BUILD_OPTIONS = Object.freeze({
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  minify: true, legalComments: 'inline', charset: 'ascii',
  treeShaking: true, preserveSymlinks: true, sourcemap: false,
});
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
  return value;
}
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function requireNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 14) fail('NODE_VERSION', `Use Node.js >=${MINIMUM_NODE} <25.`);
}
async function regularFile(root, relative) {
  if (path.isAbsolute(relative) || relative.split('/').some((part) => !part || part === '..' || part === '.')) {
    fail('SOURCE_PATH', 'Build inputs must remain inside the repository.');
  }
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) {
    fail('SOURCE_FILE', `Expected a bounded regular source file: ${relative}`);
  }
  return fs.readFile(absolute);
}
export function assertModuleCliSourceClean(root) {
  const changes = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', ...MODULE_CLI_SOURCE_PATHS]);
  if (changes) fail('SOURCE_NOT_COMMITTED', 'Commit the CLI source, lock and build script before creating release assets. Staged and unstaged changes are both rejected.');
  for (const file of [ENTRY, 'packages/classic-modules/package.json', 'package-lock.json', 'scripts/build-module-cli.mjs']) {
    git(root, ['ls-files', '--error-unmatch', '--', file]);
  }
}
function packageRootForInput(relative) {
  if (!relative.startsWith('node_modules/')) return null;
  const parts = relative.split('/');
  const lastModules = parts.lastIndexOf('node_modules');
  if (lastModules < 0 || !parts[lastModules + 1]) fail('DEPENDENCY_PATH', 'Dependency package path is invalid.');
  const count = parts[lastModules + 1].startsWith('@') ? 3 : 2;
  return parts.slice(0, lastModules + count).join('/');
}
async function dependencyEvidence(root, inputs, lock) {
  const roots = [...new Set(inputs.map(packageRootForInput).filter(Boolean))].sort();
  const dependencies = [];
  const sourcePaths = [];
  const notices = [];
  for (const packageRoot of roots) {
    const packagePath = `${packageRoot}/package.json`;
    const bytes = await regularFile(root, packagePath);
    const metadata = JSON.parse(bytes);
    const locked = lock.packages?.[packageRoot];
    if (!locked || metadata.version !== locked.version || typeof locked.integrity !== 'string') {
      fail('DEPENDENCY_LOCK', `Installed dependency does not match its lock entry: ${packageRoot}`);
    }
    const licenseNames = (await fs.readdir(path.join(root, packageRoot)))
      .filter((name) => /^(licen[cs]e|copying|notice)(?:[.-]|$)/iu.test(name)).sort();
    const licenses = [];
    for (const name of licenseNames) {
      const relative = `${packageRoot}/${name}`;
      if (!(await fs.lstat(path.join(root, relative))).isFile()) continue;
      const licenseBytes = await regularFile(root, relative);
      sourcePaths.push(relative);
      licenses.push(relative);
      notices.push(`${metadata.name}@${metadata.version} — ${name}\n${licenseBytes.toString('utf8').trim()}\n`);
    }
    if (!licenses.length) fail('DEPENDENCY_LICENSE', `Dependency license file is missing: ${packageRoot}`);
    sourcePaths.push(packagePath);
    dependencies.push({ name: metadata.name, version: metadata.version,
      lockPath: packageRoot, integrity: locked.integrity, licenses });
  }
  return { dependencies, sourcePaths, notices: Buffer.from(notices.join('\n')) };
}
function requireOnlyBuiltins(metafile) {
  const imports = Object.values(metafile.outputs).flatMap((output) => output.imports);
  for (const item of imports) {
    if (!item.external || !isBuiltin(item.path)) fail('RUNTIME_DEPENDENCY', `Standalone bundle contains a non-builtin import: ${item.path}`);
  }
  return [...new Set(['node:module', ...imports.map((item) => item.path)])].sort();
}
function emittedInputs(metafile) {
  return [...new Set(Object.values(metafile.outputs).flatMap((output) => Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file)))].sort();
}
function requireInputPaths(inputs) {
  for (const relative of inputs) {
    if (!relative.startsWith('node_modules/') && !relative.startsWith('packages/classic-modules/')) {
      fail('SOURCE_PATH', `Unexpected bundled input: ${relative}`);
    }
  }
}
async function inputHashes(root, paths) {
  return Promise.all([...new Set(paths)].sort().map(async (relative) => {
    const bytes = await regularFile(root, relative);
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  }));
}
function assertCommittedInputBytes(root, files) {
  for (const file of files.filter((item) => !item.path.startsWith('node_modules/'))) {
    const committed = execFileSync('git', ['show', `HEAD:${file.path}`], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    });
    if (sha256(committed) !== file.sha256) fail('SOURCE_NOT_COMMITTED', `Build input differs from its committed bytes: ${file.path}`);
  }
}
function assertVersionBinding(root, manifestPath, manifest) {
  let previous;
  try { previous = git(root, ['show', `HEAD:${manifestPath}`]); }
  catch { return; }
  const existing = JSON.parse(previous);
  if (existing.version !== manifest.version || existing.source.digest !== manifest.source.digest
    || existing.artifact.sha256 !== manifest.artifact.sha256) {
    fail('VERSION_ALREADY_BOUND', 'This committed CLI version already binds different source or bytes. Bump the SDK package version and create a new version directory.');
  }
}
async function ensureOutputParent(root, relative, create) {
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    if (create) await fs.mkdir(current).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('OUTPUT_PATH', 'Output parent must be a real directory.');
  }
}
async function checkOrWrite(root, files, write) {
  for (const [relative, expected] of files) {
    let actual;
    try {
      await ensureOutputParent(root, relative, write);
      actual = await regularFile(root, relative);
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual?.equals(expected)) continue;
    if (!write) fail('DISTRIBUTION_DRIFT', `Distribution is missing or differs from the committed source: ${relative}`);
    if (actual) fail('OUTPUT_EXISTS', `Refusing to overwrite different distribution bytes: ${relative}`);
    await fs.writeFile(path.join(root, relative), expected, { flag: 'wx', mode: 0o644 });
  }
}

export async function buildModuleCli({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), write = false } = {}) {
  requireNode();
  root = await fs.realpath(root);
  if (await fs.realpath(git(root, ['rev-parse', '--show-toplevel'])) !== root) fail('REPOSITORY_ROOT', 'Use the Git repository root.');
  assertModuleCliSourceClean(root);
  const metadata = JSON.parse(await regularFile(root, 'packages/classic-modules/package.json'));
  const version = metadata.version;
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(version)
    || metadata.name !== '@programmable/classic-modules' || metadata.engines?.node !== '>=24.14.0 <25') {
    fail('PACKAGE_VERSION', 'The SDK package name, version or Node.js range is not supported.');
  }
  const lock = JSON.parse(await regularFile(root, 'package-lock.json'));
  if (lock.packages?.['node_modules/esbuild']?.version !== esbuildVersion) fail('BUILDER_LOCK', 'The esbuild version must match package-lock.json.');
  const fileName = `programmable-module-mode-${version}.mjs`;
  const versionRoot = `${MODULE_CLI_RELEASE_ROOT}/v${version}`;
  const options = { ...BUILD_OPTIONS, absWorkingDir: root, entryPoints: [ENTRY], outfile: fileName,
    write: false, metafile: true, logLevel: 'silent' };
  const discovery = await build(options);
  const inputs = emittedInputs(discovery.metafile);
  requireInputPaths(Object.keys(discovery.metafile.inputs));
  requireOnlyBuiltins(discovery.metafile);
  const dependency = await dependencyEvidence(root, inputs, lock);
  for (const [name, expectedVersion] of Object.entries(metadata.dependencies ?? {})) {
    if (!dependency.dependencies.some((item) => item.name === name && item.version === expectedVersion)) {
      fail('SDK_DEPENDENCY_LOCK', `SDK dependency must use its declared exact version: ${name}`);
    }
  }
  const sourceFiles = await inputHashes(root, [...inputs, ...dependency.sourcePaths,
    'packages/classic-modules/package.json', 'package-lock.json', 'scripts/build-module-cli.mjs']);
  assertCommittedInputBytes(root, sourceFiles);
  const source = { format: 'programmable.module-cli-source.v1', packageVersion: version,
    entryPoint: ENTRY, builder: { esbuild: esbuildVersion, options: BUILD_OPTIONS }, files: sourceFiles };
  const sourceDigest = sha256(jsonBytes(source));
  const banner = [
    `// Programmable Module Mode CLI ${version}; source sha256:${sourceDigest}.`,
    "import { createRequire as moduleCliCreateRequire } from 'node:module';",
    'const require = moduleCliCreateRequire(import.meta.url);',
    "if (Number(process.versions.node.split('.')[0]) !== 24 || Number(process.versions.node.split('.')[1]) < 14) { process.stderr.write('Use Node.js >=24.14.0 <25.\\n'); process.exit(1); }",
    `if (process.argv.length === 3 && process.argv[2] === '--version') { process.stdout.write(${JSON.stringify(`${version}\n`)}); process.exit(0); }`,
  ].join('\n');
  const built = await build({ ...options, banner: { js: banner } });
  const runtimeBuiltins = requireOnlyBuiltins(built.metafile);
  if (JSON.stringify(emittedInputs(built.metafile)) !== JSON.stringify(inputs)) fail('SOURCE_CHANGED', 'Build inputs changed during release generation.');
  const artifact = Buffer.from(built.outputFiles[0].contents);
  if (built.outputFiles.length !== 1 || artifact.length > MAXIMUM_BUNDLE_BYTES) fail('BUNDLE_SIZE', 'Expected one standalone CLI file under 1 MiB.');
  assertModuleCliSourceClean(root);
  if (JSON.stringify(await inputHashes(root, sourceFiles.map((file) => file.path))) !== JSON.stringify(sourceFiles)) fail('SOURCE_CHANGED', 'Source bytes changed during release generation.');
  const basePath = versionRoot.slice('public'.length);
  const manifest = {
    schemaVersion: MODULE_CLI_RELEASE_SCHEMA, name: 'programmable-module-mode', version,
    runtime: { node: metadata.engines.node, externalModules: runtimeBuiltins, requiresNpmInstall: false },
    artifact: { file: fileName, path: `${basePath}/${fileName}`, mediaType: 'text/javascript', bytes: artifact.length, sha256: sha256(artifact) },
    licenses: { file: 'LICENSES.txt', path: `${basePath}/LICENSES.txt`, bytes: dependency.notices.length, sha256: sha256(dependency.notices) },
    source: { repository: 'https://github.com/programmablehq/PROGRAMMABLE', digest: sourceDigest, ...source },
    dependencies: dependency.dependencies,
    assurance: { contentHashesOnly: true, signed: false, moduleApproval: false, onchainApproval: false },
  };
  const manifestPath = `${versionRoot}/manifest.json`;
  assertVersionBinding(root, manifestPath, manifest);
  const checksums = Buffer.from(`${manifest.artifact.sha256}  ${fileName}\n${manifest.licenses.sha256}  LICENSES.txt\n`);
  const files = new Map([
    [`${versionRoot}/${fileName}`, artifact], [`${versionRoot}/LICENSES.txt`, dependency.notices],
    [`${versionRoot}/SHA256SUMS`, checksums], [manifestPath, jsonBytes(manifest)],
  ]);
  await checkOrWrite(root, files, write);
  return { ok: true, mode: write ? 'write' : 'check', version,
    manifestPath, artifactPath: `${versionRoot}/${fileName}`, bytes: artifact.length,
    sha256: manifest.artifact.sha256, sourceDigest, signed: false, published: false };
}

async function main(args) {
  if (args.includes('--help')) {
    process.stdout.write('Build a deterministic standalone Module Mode CLI.\nUsage: node scripts/build-module-cli.mjs [--write] [--root repository]\nDefault checks generated assets without changing them. Source and build script must be committed.\n');
    return;
  }
  let root; let write = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--write' && !write) write = true;
    else if (args[index] === '--root' && root === undefined && args[index + 1]) root = args[++index];
    else fail('ARGUMENT', 'Use --help for supported arguments.');
  }
  process.stdout.write(`${JSON.stringify(await buildModuleCli({ root, write }), null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'BUILD_FAILED', message: error.message })}\n`);
    process.exitCode = 1;
  });
}
