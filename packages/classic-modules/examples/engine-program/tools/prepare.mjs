import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIXTURE_IDENTITY = Object.freeze({
  author: '0x1111111111111111111111111111111111111111',
  rewardWallet: '0x2222222222222222222222222222222222222222',
  familySalt: `0x${'0'.repeat(63)}1`,
});
const reservedWallets = new Set([
  ...Object.values(FIXTURE_IDENTITY), '0x3333333333333333333333333333333333333333', `0x${'0'.repeat(40)}`,
]);
const maximumFile = 4 * 1024 * 1024;
const maximumTotal = 16 * 1024 * 1024;

// Explicit paths only. Source data is never imported, evaluated, fetched or executed here.
export async function readSource(root, path, maximum = maximumFile) {
  if (typeof path !== 'string' || path.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)
    || isAbsolute(path) || path.includes('\\')
    || path.split('/').some((part) => !part || part === '.' || part === '..')
    || /[\u0000-\u001f\u007f]/u.test(path)) throw new Error('Source path must remain below its selected root');
  const sourceRoot = await realpath(root);
  let target = sourceRoot;
  for (const part of path.split('/')) {
    target = resolve(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new Error(`Symlink is not source: ${path}`);
  }
  const stat = await lstat(target);
  if (!target.startsWith(`${sourceRoot}${sep}`) || !stat.isFile() || stat.size > maximum) {
    throw new Error(`Invalid or oversized source file: ${path}`);
  }
  const bytes = await readFile(target);
  if (bytes.length > maximum) throw new Error(`Oversized source file: ${path}`);
  return bytes;
}

function checkedIdentity(identity, fixture) {
  if (fixture) {
    if (Object.keys(identity).length) throw new Error('--fixture cannot be combined with real contributor identity');
    return { ...FIXTURE_IDENTITY };
  }
  const { author, rewardWallet, familySalt } = identity;
  for (const address of [author, rewardWallet]) {
    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address) || reservedWallets.has(address.toLowerCase())) {
      throw new Error('Replace fixture author/reward wallets with your own nonzero EVM wallets');
    }
  }
  if (typeof familySalt !== 'string' || !/^0x[0-9a-f]{64}$/.test(familySalt)
    || /^0x0+$/.test(familySalt) || familySalt === FIXTURE_IDENTITY.familySalt) {
    throw new Error('Use a fresh nonzero lowercase bytes32 family salt');
  }
  return { author: author.toLowerCase(), rewardWallet: rewardWallet.toLowerCase(), familySalt };
}

export async function prepareDescriptor(root, identity = {}, { fixture = false } = {}) {
  const identified = checkedIdentity(identity, fixture);
  const descriptor = JSON.parse(await readSource(root, 'module.template.json', 512 * 1024));
  const declared = JSON.parse(await readSource(root, 'package-files.json', 64 * 1024));
  if (!Array.isArray(declared) || declared.length < 1 || declared.length > 128
    || declared.some((path) => typeof path !== 'string') || new Set(declared).size !== declared.length
    || declared.includes('module.json')) throw new Error('Declare 1–128 unique source paths; do not self-hash module.json');
  let total = 0;
  const files = [];
  for (const path of [...declared].sort()) {
    const bytes = await readSource(root, path);
    total += bytes.length;
    if (total > maximumTotal) throw new Error('Source exceeds 16 MiB');
    files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  Object.assign(descriptor, identified);
  descriptor.configuration = JSON.parse(await readSource(root, 'config.schema.json', 64 * 1024));
  descriptor.source = { files };
  descriptor.extensions = {
    ...descriptor.extensions,
    'programmable.starter-identity@1': { fixtureOnly: fixture, ownershipProven: false },
  };
  // Do not follow an existing output symlink. This is an explicit descriptor regeneration command.
  const target = resolve(root, 'module.json');
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Output cannot be a symlink'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(target, `${JSON.stringify(descriptor, null, 2)}\n`);
  return { path: target, sourceFiles: files.length, sourceBytes: total, fixtureOnly: fixture, authorAuthenticated: false };
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (Object.hasOwn(options, flag)) throw new Error(`Repeated option: ${flag}`);
    if (flag === '--fixture') { options[flag] = true; continue; }
    if (!['--root', '--author', '--reward-wallet', '--family-salt'].includes(flag) || !args[i + 1]
      || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${flag}`);
    options[flag] = args[++i];
  }
  const root = options['--root'] || resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const identity = Object.fromEntries([
    ['author', '--author'], ['rewardWallet', '--reward-wallet'], ['familySalt', '--family-salt'],
  ].filter(([, flag]) => Object.hasOwn(options, flag)).map(([name, flag]) => [name, options[flag]]));
  console.log(JSON.stringify(await prepareDescriptor(root, identity, { fixture: options['--fixture'] === true }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
