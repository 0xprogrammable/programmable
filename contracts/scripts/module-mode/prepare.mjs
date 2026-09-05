#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, simulationInput, need, canonicalJson } from './core.mjs';
import { sourceVerificationRequests, sourcifyVerificationRequests } from './evidence.mjs';
import { exactJson } from './source-readback.mjs';
import { REPOSITORY_ROOT, sealBuild } from './build.mjs';

export async function prepare({ parametersFile, outputDirectory, candidate = false }) {
  const parameters = exactJson(await readFile(parametersFile), 'Deployment parameters');
  const build = await sealBuild({ candidate }); const plan = buildPlan(build, parameters);
  await mkdir(outputDirectory, { recursive: true });
  const abi = { schemaVersion: 'programmable.module-mode-deployment-abi.v1', sourceCommit: plan.sourceCommit, buildDigest: plan.buildDigest,
    contracts: Object.fromEntries(Object.entries(build.artifacts).map(([role, artifact]) => [role, { compilationTarget: artifact.compilationTarget,
      ...(plan.contracts[role] ? { address: plan.contracts[role].address, runtimeCodeHash: plan.contracts[role].runtimeCodeHash } : {}), abi: artifact.abi }])) };
  for (const [name, data] of Object.entries({ 'plan.json': JSON.stringify(plan, null, 2), 'build.json': JSON.stringify(build),
    'source-verification-requests.json': JSON.stringify(sourceVerificationRequests(plan, build), null, 2),
    'sourcify-verification-requests.json': JSON.stringify(sourcifyVerificationRequests(plan, build), null, 2),
    'abi.json': JSON.stringify(abi, null, 2), 'simulation-input.hex': simulationInput(plan) })) {
    await writeFile(path.join(outputDirectory, name), `${data}\n`, { flag: 'wx', mode: 0o600 });
  }
  await writeFile(path.join(outputDirectory, 'simulation-input.bin'), Buffer.from(simulationInput(plan).slice(2), 'hex'), { flag: 'wx', mode: 0o600 });
  const verificationDirectory = path.join(outputDirectory, 'source-verification'); await mkdir(verificationDirectory);
  for (const [role, input] of Object.entries(build.standardInputs)) {
    await writeFile(path.join(verificationDirectory, `${role}.standard-input.json`), canonicalJson(input), { flag: 'wx', mode: 0o600 });
  }
  return { planDigest: plan.planDigest, sourceCommit: plan.sourceCommit, sourceClean: plan.sourceClean, chainId: plan.chainId,
    owner: parameters.owner, reviewAuthority: parameters.reviewAuthority, minimumInitialBuyNative: parameters.minimumInitialBuyNative,
    noModuleRecipient: plan.economics.noModuleRecipient, stages: plan.steps.map(step => ({ index: step.index, role: step.role, target: step.target, value: step.value, initcodeBytes: step.initcodeBytes, runtimeBytes: plan.contracts[step.role].runtimeBytes })),
    status: 'unsigned-unapproved-preparation', files: outputDirectory };
}
async function main(argv) {
  const args = { parametersFile: path.join(REPOSITORY_ROOT, 'ops/module-mode-deployment/release-parameters.v1.json'), outputDirectory: null, candidate: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (key === '--candidate') args.candidate = true;
    else if (key === '--parameters') args.parametersFile = path.resolve(argv[++i]);
    else if (key === '--output') args.outputDirectory = path.resolve(argv[++i]);
    else throw new Error(`Unsupported option: ${key.split('=')[0]}`);
  }
  need(args.outputDirectory, '--output is required and must not already contain preparation files');
  console.log(JSON.stringify(await prepare(args), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
