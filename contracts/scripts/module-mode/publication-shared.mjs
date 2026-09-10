import { build, version } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { REPOSITORY_ROOT } from './build.mjs';
import { need, sha256 } from './core.mjs';
import { moduleEngineSdkBundle } from '../module-engine/sdk-bundle.mjs';
let loaded;
export async function publicationValidators() {
  if (loaded) return loaded;
  const lock = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'package-lock.json'), 'utf8'));
  need(lock.packages['node_modules/esbuild'].version === version, 'Shared validator compiler differs from package-lock');
  const serverDirectory = path.dirname(createRequire(import.meta.url).resolve('server-only'));
  const serverPackage = JSON.parse(await readFile(path.join(serverDirectory, 'package.json'), 'utf8'));
  need(serverPackage.name === 'server-only' && serverPackage.version === lock.packages['node_modules/server-only'].version
    && serverPackage.exports?.['.']?.['react-server'] === './empty.js', 'Locked server-only server export differs');
  const sdk = moduleEngineSdkBundle();
  // This is an existing Node server process. Preserve Next's boundary marker in public bundles;
  // select only its locked server export here, without changing React's global conditions.
  const serverOnly = { name: 'operator-server-only-export', setup(bundler) {
    bundler.onResolve({ filter: /^server-only$/ }, () => ({ path: path.join(serverDirectory, 'empty.js') }));
  } };
  const result = await build({ ...sdk, plugins: [...sdk.plugins, serverOnly], absWorkingDir: REPOSITORY_ROOT, entryPoints: ['contracts/scripts/module-mode/publication-shared.ts'], write: false,
    bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', treeShaking: true, sourcemap: false,
    tsconfig: path.join(REPOSITORY_ROOT, 'tsconfig.json'), logLevel: 'silent' });
  const output = result.outputFiles[0].contents, directory = path.join(REPOSITORY_ROOT, 'contracts/out/module-mode-publication/shared');
  await mkdir(directory, { recursive: true }); const file = path.join(directory, `${sha256(output)}.mjs`);
  try { await writeFile(file, output, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; need(sha256(await readFile(file)) === sha256(output), 'Shared validator cache differs'); }
  loaded = await import(pathToFileURL(file).href); return loaded;
}
