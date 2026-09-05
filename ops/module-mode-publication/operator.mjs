#!/usr/bin/env node
import { build, version } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertRobinhoodFoundationRpcProviders } from '../../contracts/scripts/robinhood-custom-launch-owner-envelope-core.mjs';
import { resolveReviewedRobinhoodProviderCommitments } from '../../contracts/scripts/robinhood-custom-launch-provider-commitment-custody.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function main() {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  if (lock.packages['node_modules/esbuild'].version !== version) throw new Error('Operator compiler differs from package-lock');
  const compiled = await build({ absWorkingDir: root, entryPoints: ['ops/module-mode-publication/main.ts'], write: false,
    bundle: true, packages: 'external', platform: 'node', target: 'node24', format: 'esm', sourcemap: false,
    tsconfig: path.join(root, 'tsconfig.json'), treeShaking: true, logLevel: 'silent' });
  const bytes = compiled.outputFiles[0].contents; const digest = createHash('sha256').update(bytes).digest('hex');
  const cache = path.join(root, 'contracts/out/module-mode-publication'); await mkdir(cache, { recursive: true });
  const entry = path.join(cache, digest + '.mjs');
  try { await writeFile(entry, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST' || !Buffer.from(await readFile(entry)).equals(Buffer.from(bytes))) throw new Error('Operator bundle cache differs'); }
  const runtime = await import(pathToFileURL(entry).href);
  await runtime.run(process.argv.slice(2), { repositoryRoot: root, providers: async () => {
    const rpcUrls = [process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY, process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY];
    const endpointCommitments = await resolveReviewedRobinhoodProviderCommitments({ env: process.env, repositoryRoot: root });
    return assertRobinhoodFoundationRpcProviders({ rpcUrls, endpointCommitments }).map((binding, index) => ({ ...binding, url: rpcUrls[index] }));
  } });
}
main().catch(error => { console.error(error?.name === 'ModulePublicationError' ? error.message : 'Module publication stopped before completion. Check the authenticated session, reviewed source, RPC bindings and required inputs. No transaction was sent.'); process.exitCode = 1; });
