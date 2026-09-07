import { build, version } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { need, sha256 } from '../module-mode/core.mjs';
let loaded;
/** Same locked bundling/cache mechanism as the native release validator, selecting the separate Engine wire. */
export async function engineWire() {
  if (loaded) return loaded;
  const lock = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'package-lock.json'), 'utf8'));
  need(lock.packages['node_modules/esbuild'].version === version, 'Engine validator compiler differs from package-lock');
  const result = await build({ absWorkingDir: REPOSITORY_ROOT, entryPoints: ['contracts/scripts/module-engine/shared.ts'], write: false,
    bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external', treeShaking: true, sourcemap: false,
    tsconfig: path.join(REPOSITORY_ROOT, 'tsconfig.json'), logLevel: 'silent' });
  const output = result.outputFiles[0].contents, directory = path.join(REPOSITORY_ROOT, 'contracts/out/module-engine-deployment/shared');
  await mkdir(directory, { recursive: true }); const file = path.join(directory, `${sha256(output)}.mjs`);
  try { await writeFile(file, output, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; need(sha256(await readFile(file)) === sha256(output), 'Engine validator cache differs'); }
  loaded = await import(pathToFileURL(file).href); return loaded;
}
