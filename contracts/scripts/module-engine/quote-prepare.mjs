#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, need } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { sealQuoteBuild } from './quote-build.mjs';
import { buildQuotePlan, quoteBasis, quoteReviewConfiguration, quoteSimulationInput, QUOTE_CONFIGURATION_ABI, QUOTE_ROLES } from './quote-core.mjs';
import { quoteExplorerRequests, quoteSourceRequests } from './quote-evidence.mjs';

export async function prepareQuote({ root = REPOSITORY_ROOT, parametersFile, reviewConfigurationFile, outputDirectory, candidate = false }) {
  const build = await sealQuoteBuild({ root, candidate }), basis = await quoteBasis(root);
  const parameters = parametersFile ? exactJson(await readFile(parametersFile), 'Quote deployment parameters')
    : { owner: basis.deploymentOwner, releaseLabel: 'robinhood-engine-quote-v1' };
  const plan = buildQuotePlan(build, parameters, basis), simulation = quoteSimulationInput(plan);
  const reviewConfiguration = reviewConfigurationFile
    ? quoteReviewConfiguration(plan, exactJson(await readFile(reviewConfigurationFile), 'Explicit Quote review parameters')) : null;
  const draft = { schemaVersion: 'programmable.module-engine-quote-infrastructure-draft.v1', chainId: 4663,
    status: 'planned-not-deployed', planDigest: plan.planDigest, identityCandidate: plan.identityCandidate, authority: plan.authority,
    pending: ['independent-review-and-hosted-source-verify', 'fresh-independent-rpc-quorum', 'fork-simulation-at-bound-block',
      'owner-reviewed-zero-value-transactions-and-separate-gas-ceilings', 'actual-planner-and-converter-deployments',
      'exact-source-verification-and-retained-forwarder-proof', 'explicit-template-price-and-tier-review',
      'reviewed-fixed-configuration-publication', 'actual-market-qualification-and-launch-evidence'] };
  const abi = { schemaVersion: 'programmable.module-engine-quote-deployment-abi.v1', sourceCommit: build.sourceCommit, buildDigest: build.buildDigest,
    contracts: Object.fromEntries(QUOTE_ROLES.map(role => [role, { compilationTarget: build.artifacts[role].compilationTarget,
      abi: build.artifacts[role].abi, address: plan.contracts[role].address, runtimeCodeHash: plan.contracts[role].runtimeCodeHash }])) };
  const requirements = { schemaVersion: 'programmable.module-engine-quote-configuration-requirements.v1', planDigest: plan.planDigest,
    status: reviewConfiguration ? 'explicit-values-prepared-unapproved' : 'explicit-price-and-fee-tier-required', abi: QUOTE_CONFIGURATION_ABI,
    requiredInput: { initialQuotePerTokenX18: 'positive decimal uint256 string, explicitly reviewed primary-token start price',
      feeTier: 'integer: 100, 500, 3000 or 10000; explicitly reviewed direct Quote/WETH V3 tier' },
    immutableBindings: { ...plan.dependencies, ...Object.fromEntries(QUOTE_ROLES.map(role => [role, plan.identityCandidate.contracts[role]])) },
    fixedConfigurationRequired: true, quoteAssetPolicy: 'free per launch; zero fixedQuoteAsset; actual market must qualify independently',
    globalEngineDeployment: false, templatePublication: 'not-approved-or-submitted' };
  await mkdir(outputDirectory, { recursive: true });
  const files = { 'plan.json': JSON.stringify(plan, null, 2), 'build.json': JSON.stringify(build), 'basis.json': JSON.stringify(basis, null, 2),
    'infrastructure-draft.json': JSON.stringify(draft, null, 2), 'abi.json': JSON.stringify(abi, null, 2),
    'review-configuration-requirements.json': JSON.stringify(requirements, null, 2),
    'review-compiler-parity.json': JSON.stringify(build.reviewCompilerParity, null, 2),
    'quote-review.standard-input.json': canonicalJson(build.reviewCompilerInput),
    ...(reviewConfiguration ? { 'review-configuration.json': JSON.stringify(reviewConfiguration, null, 2) } : {}),
    'sourcify-verification-requests.json': JSON.stringify(quoteSourceRequests(plan, build), null, 2),
    'source-verification-requests.json': JSON.stringify(quoteExplorerRequests(plan, build), null, 2), 'simulation-input.hex': simulation };
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(outputDirectory, name), `${data}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(outputDirectory, 'simulation-input.bin'), Buffer.from(simulation.slice(2), 'hex'), { flag: 'wx', mode: 0o600 });
  const sourceDirectory = path.join(outputDirectory, 'source-verification'); await mkdir(sourceDirectory);
  for (const role of QUOTE_ROLES) await writeFile(path.join(sourceDirectory, `${role}.standard-input.json`), canonicalJson(build.standardInputs[role]), { flag: 'wx', mode: 0o600 });
  return { status: 'unsigned-unapproved-quote-infrastructure-preparation', chainId: 4663, sourceCommit: build.sourceCommit,
    sourceClean: build.sourceClean, planDigest: plan.planDigest, buildDigest: build.buildDigest, basisDigest: basis.basisDigest,
    reuseSourceDigest: build.reuseSourceDigest, owner: parameters.owner,
    contracts: Object.fromEntries(QUOTE_ROLES.map(role => [role, { ...plan.identityCandidate.contracts[role],
      initcodeBytes: plan.steps[QUOTE_ROLES.indexOf(role)].initcodeBytes, runtimeBytes: plan.contracts[role].runtimeBytes }])),
    transactionValueWei: '0', gas: plan.funding.gas, reviewConfiguration: requirements.status, files: outputDirectory };
}
async function main(argv) {
  const options = { candidate: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (key === '--candidate') { need(!options.candidate, 'Duplicate candidate option'); options.candidate = true; }
    else { const name = { '--parameters': 'parametersFile', '--review-configuration': 'reviewConfigurationFile', '--output': 'outputDirectory' }[key];
      need(name && argv[i + 1] && !argv[i + 1].startsWith('--') && !options[name],
        'Use --output DIRECTORY [--parameters FILE] [--review-configuration FILE] [--candidate]'); options[name] = path.resolve(argv[++i]); }
  }
  need(options.outputDirectory, '--output required'); console.log(JSON.stringify(await prepareQuote(options), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
