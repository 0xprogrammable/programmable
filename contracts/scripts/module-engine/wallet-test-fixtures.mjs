// Explicit synthetic provider/review doubles. Never deployment, acceptance or wallet evidence.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi, keccak256, parseAbiParameters } from 'viem';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { canonicalJson, hexQuantity, jsonSafe, sha256 } from '../module-mode/core.mjs';
import { publicationValidators } from '../module-mode/publication-shared.mjs';
import { registryAbi, ZERO_ADDRESS } from '../module-mode/publication-plan.mjs';
import { rpcClient } from '../module-mode/rpc.mjs';
export const h = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
export const a = n => `0x${BigInt(n).toString(16).padStart(40, '0')}`;
const reviewDigest = (domain, value) => `0x${sha256(canonicalJson({ domain, value }))}`;
export async function engineWalletFixture({ initial = false, fixed = false } = {}) {
  const frozen = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'tests/fixtures/module-engine-review-build.json'), 'utf8'));
  if (frozen.evidenceClass !== 'synthetic-parser-fixture-not-review-or-publication-authority') throw new Error('Synthetic fixture boundary differs');
  const api = await publicationValidators(), source = frozen.source, artifact = frozen.artifact, buildPlan = frozen.plan, subject = frozen.subject;
  const reviewer = a(991), actor = a(992), codes = new Map();
  const contracts = Object.fromEntries(['host', 'registry', 'tokenFactory', 'launchPolicy', 'ledger', 'poolManager'].map((role, i) => {
    const address = a(900 + i), runtime = `0x60${(i + 1).toString(16).padStart(2, '0')}`; codes.set(address, runtime); return [role, { address, runtimeCodeHash: keccak256(runtime) }];
  }));
  const base = { schemaVersion: 'programmable.module-engine.release.v1', sourceVersion: 'module-engine-v1', engineProfile: 'programmable.module-engine-solidity@1', chainId: 4663,
    sourceCommit: '1'.repeat(40), startBlock: '1', tokenCreationCodeHash: h(994), economicsPolicyId: keccak256(new TextEncoder().encode('programmable.module-mode.native-economics.v2')),
    finalityPolicy: 'robinhood-ethereum-finality-v1', contracts };
  // Reuse an existing fixture's exact finality spelling, not a made-up policy authority.
  const native = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'config/module-mode/historical-releases.json'), 'utf8'));
  const findPolicy = value => value && typeof value === 'object' ? value.finalityPolicy ?? Object.values(value).map(findPolicy).find(Boolean) : undefined;
  base.finalityPolicy = findPolicy(native);
  const identity = { ...base, releaseDigest: api.computeModuleEngineReleaseDigest(base) };
  const quote = { address: a(0x1002), runtimeCodeHash: keccak256('0x600100'), decimals: 18 }; codes.set(quote.address, '0x600100');
  const definition = { profile: 'programmable.module-engine-solidity@1', catalogDefinition: { id: 'operator-fixture', title: 'Synthetic engine operator', summary: 'Synthetic local test.', detail: 'Never publication authority.', version: source.descriptor.version,
    interface: 'custom-v1', source: source.descriptor.source.files[0], schema: source.descriptor.configuration, defaults: { cap: '5' }, configurationAbi: artifact.configurationAbi, constraints: [] },
    revision: { packageId: artifact.packageId, familyId: artifact.familyId, fixedQuoteAsset: fixed ? quote.address : ZERO_ADDRESS, fixedConfigurationHash: fixed ? artifact.cases[0].configHash : h(0),
      initialOperationId: initial ? artifact.operationPermissions[2].operationId : h(0), executionGas: artifact.executionGas, moneyRights: artifact.moneyRights, coinRights: 0, operationPermissions: artifact.operationPermissions, eligibleFamilies: [artifact.familyId] } };
  const manifest = api.createReviewedModuleEngineManifest({ job: { artifact, plan: buildPlan }, descriptor: source.descriptor, release: identity, definition: definition.catalogDefinition, revision: definition.revision });
  const record = { schemaVersion: 'programmable.modules.review-decision.v1', reviewerWallet: reviewer, policyDigest: h(997), subject,
    command: { schemaVersion: 'programmable.modules.review-command.v1', submissionId: subject.submissionId, requestDigest: subject.requestDigest, expectedReviewRevision: 2, outcome: 'accept',
      reason: 'Synthetic operator tests only; no real authority.', artifactDigest: artifact.artifactDigest, hostManifestHash: api.computeModuleEngineHostManifestHash(manifest), acknowledgedReviewAreas: artifact.reviewRequired },
    decidedAt: '2026-09-07T01:11:00.000Z', registryApproved: false, available: false };
  const review = { ...record, decisionDigest: reviewDigest(record.schemaVersion, record) };
  const bundle = { source, manifest, review, artifact, buildPlan };
  const worker = { sourceCommit: 'a'.repeat(40), runId: '123', runAttempt: '1', workflowRef: 'programmablehq/programmable-open-hook-v2-internal/.github/workflows/protected-module-review-v1.yml@refs/heads/main' };
  const job = { subject, state: 'accepted', reviewRevision: 3, plan: buildPlan, planDigest: artifact.planDigest, artifact, attempt: 1, lastError: null, createdAt: '2026-09-07T01:00:00.000Z', updatedAt: '2026-09-07T01:10:00.000Z' };
  const attempt = { attempt: 1, requestDigest: subject.requestDigest, planDigest: artifact.planDigest, errorCode: null };
  const detail = { schemaVersion: 'programmable.modules.website-review-detail.v1', job, decisions: [review], attempts: [
    { ...attempt, event: 'claimed', artifactDigest: null, workerIdentity: { ...worker, identityDigest: reviewDigest('programmable.modules.worker-identity.v1', worker) }, createdAt: job.createdAt },
    { ...attempt, event: 'completed', artifactDigest: artifact.artifactDigest, workerIdentity: null, createdAt: job.updatedAt },
  ] };
  const fakeFetch = async (url, init) => { if (!String(url).startsWith('https://programmable.market/api/admin/modules/') || init.method !== 'GET' || init.redirect !== 'error') throw new Error('Unexpected fixture HTTP authority'); return Response.json(String(url).includes('/source?') ? source : detail); };
  const current = () => api.createAuthenticatedReviewReader({ walletAddress: reviewer, accessToken: 'synthetic_operator_test_session_1234' }, fakeFetch).read(subject.submissionId);
  const initialOperation = initial ? { operationId: artifact.operationPermissions[2].operationId, recipient: actor, inputAsset: 'quote', inputAmount: '2', outputAsset: 'native', minimumOutput: '0', data: h(2) } : null;
  const action = { kind: 'launch', name: 'Synthetic operator coin', symbol: 'OPTEST', description: 'Local test only.', imageUri: '', socialLinks: {}, quote,
    configuration: { cap: '5' }, creatorSalt: h(1100), engineSalt: h(1101), launchData: '0x', creatorWallets: [actor], creatorSharesBps: [10000], buyCreatorFeeBps: 100, sellCreatorFeeBps: 100,
    initialOperation, deadline: String(Math.floor(Date.now() / 1000) + 600), funding: { mode: initial ? 'approve' : 'none', expectedAllowance: '0' } };
  return { api, source, artifact, bundle, definition, identity, reviewer, owner: actor, sourceState: { sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), sourceClean: false }, action, quote, codes, current, detail };
}

export function engineWorld(f, initialPlan, { published = true } = {}) {
  const { api } = f, methods = [], pins = f.identity.contracts, host = pins.host.address;
  let head = 256n, nextHash = 2000, currentPlan = initialPlan;
  const initial = { family: published, revision: published, enabled: true, allowance: '0', actorNonce: {}, eoaNonce: '1', launched: null, engineRuntime: null };
  let state = structuredClone(initial); const states = new Map(), blocks = new Map(), txs = new Map(), receipts = new Map();
  const save = () => { const number = hexQuantity(head); states.set(number, structuredClone(state)); blocks.set(number, { number, hash: h(head), timestamp: hexQuantity(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1', transactions: [...txs].filter(([, tx]) => tx.blockNumber === number).map(([hash]) => hash) }); }; save();
  const mutations = {};
  const revision = api.engineRegistryRevision({ manifest: f.bundle.manifest, manifestHash: api.computeModuleEngineHostManifestHash(f.bundle.manifest) });
  const absent = Object.fromEntries(Object.entries(revision).map(([key, v]) => [key, typeof v === 'boolean' ? false : typeof v === 'number' ? 0 : key === 'fixedQuoteAsset' ? ZERO_ADDRESS : h(0)]));
  const lookup = block => block && block !== 'latest' && block !== 'pending' ? states.get(block) : state;
  const expected = () => currentPlan.steps.at(-1).expectation;
  const originalPlan = () => currentPlan.action?.kind === 'execute' ? currentPlan.action.launch.plan : currentPlan;
  const p = () => originalPlan().steps.find(s => s.kind === 'engine-launch')?.arguments[0];
  const result = encodeAbiParameters(parseAbiParameters('uint256'), [17n]);
  const simulationRecord = () => ({ ...expected(), resourcesHash: mutations.resourcesHash ?? h(1999) });
  const eventLog = (name, args, txHash, block) => {
    const shape = api.moduleEngineHostAbi.find(item => item.type === 'event' && item.name === name), fields = shape.inputs.filter(i => !i.indexed);
    return { address: host, data: encodeAbiParameters(fields, fields.map(i => args[i.name])), topics: encodeEventTopics({ abi: api.moduleEngineHostAbi, eventName: name, args }),
      blockNumber: block.number, blockHash: block.hash, transactionHash: txHash, transactionIndex: '0x0', logIndex: '0x0', removed: false };
  };
  const rpc = async (method, params, provider) => {
    methods.push({ method, params, provider }); if (mutations.rpc) { const value = mutations.rpc(method, params, provider); if (value !== undefined) return value; }
    const s = lookup(method === 'eth_call' ? params[1] : method === 'eth_getCode' ? params[1] : undefined);
    if (method === 'eth_chainId') return mutations.chain ?? '0x1237';
    if (method === 'eth_getBlockByNumber') return params[0] === 'latest' ? blocks.get(hexQuantity(head)) : blocks.get(params[0]);
    if (method === 'eth_getCode') {
      if (params[0] === s.launched?.engine) return s.engineRuntime;
      if (params[0] === s.launched?.token) return '0x601100';
      return f.codes.get(params[0]) ?? '0x';
    }
    if (method === 'eth_getTransactionCount') return f.codes.has(params[0]) || [expected()?.token, expected()?.engine].includes(params[0]) ? '0x0' : hexQuantity(params[1] === 'pending' && mutations.pending ? BigInt(state.eoaNonce) + 1n : state.eoaNonce);
    if (method === 'eth_getBalance') return mutations.balance ?? '0xffffffffffffffff';
    if (method === 'eth_estimateGas') return mutations.gas ?? '0x186a0';
    if (method === 'eth_getTransactionByHash') { const tx = txs.get(params[0]); return tx && mutations.tx ? { ...tx, ...mutations.tx } : tx; }
    if (method === 'eth_getTransactionReceipt') return receipts.get(params[0]) ?? null;
    if (method !== 'eth_call') throw new Error(`Unexpected synthetic RPC ${method}`);
    const { to, data } = params[0]; let decoded, abi;
    for (const candidate of [api.moduleEngineHostAbi, api.moduleEngineReadAbi, api.moduleEngineLedgerAbi, registryAbi, erc20Abi]) { try { decoded = decodeFunctionData({ abi: candidate, data }); abi = candidate; break; } catch {} }
    if (!decoded) throw new Error('Unknown synthetic call'); const { functionName: fn, args = [] } = decoded;
    let value;
    if (fn === 'SOURCE_VERSION') value = api.MODULE_ENGINE_SOURCE_ID;
    else if (['tokenFactory', 'launchPolicy', 'registry', 'ledger'].includes(fn)) value = pins[fn].address;
    else if (fn === 'hook') value = host;
    else if (fn === 'poolManager') value = pins.poolManager.address;
    else if (fn === 'owner') value = mutations.registryOwner ?? f.reviewer;
    else if (fn === 'ECONOMICS_POLICY_ID') value = f.identity.economicsPolicyId;
    else if (fn === 'PROTOCOL_FEE_BPS') value = 10;
    else if (fn === 'AUTHOR_POOL_FEE_BPS') value = 20;
    else if (fn === 'families') value = s.family ? [f.source.descriptor.author, f.source.descriptor.rewardWallet] : [ZERO_ADDRESS, ZERO_ADDRESS];
    else if (fn === 'getRevision') value = s.revision ? [{ ...revision, enabled: s.enabled }, f.artifact.engine.immutableRuntimeOffsets, f.artifact.engine.immutableConstructorOffsets, f.definition.revision.eligibleFamilies] : [absent, [], [], []];
    else if (fn === 'permission') value = f.artifact.operationPermissions.find(p => p.operationId === args[1]);
    else if (fn === 'getLaunch') value = s.launched;
    else if (fn === 'launchIdOf' || fn === 'engineLaunchId') value = s.launched.launchId;
    else if (fn === 'nonces') value = BigInt(s.actorNonce[args[1].toLowerCase()] ?? '0');
    else if (fn === 'decimals') value = 18;
    else if (fn === 'balanceOf') value = 1000000n;
    else if (fn === 'allowance') value = BigInt(s.allowance);
    else if (fn === 'approve') value = true;
    else if (fn === 'name') value = p().name;
    else if (fn === 'symbol') value = p().symbol;
    else if (fn === 'creator') value = host;
    else if (fn === 'totalSupply') value = 1000000000n * 10n ** 18n;
    else if (fn === 'graffiti') value = keccak256(encodeAbiParameters(parseAbiParameters('string,address,bytes32'), ['programmable.module-engine.token.v1', s.launched.creator, p().creatorSalt]));
    else if (fn === 'getUERC20Address') value = s.launched.token;
    else if (fn === 'contextHash') value = keccak256(encodeAbiParameters(parseAbiParameters(api.ENGINE_CONTEXT), [{ host, launchId: s.launched.launchId, token: s.launched.token, creator: s.launched.creator, quoteAsset: s.launched.quoteAsset, feeCollector: host }]));
    else if (fn === 'predictTokenAddress') value = [expected().token, keccak256(encodeAbiParameters(parseAbiParameters('string,address,bytes32'), ['programmable.module-engine.token.v1', currentPlan.owner, p().creatorSalt]))];
    else if (fn === 'fixedConfigurationHash') value = f.definition.revision.fixedConfigurationHash;
    else if (fn === 'platformFeeBps') value = 30;
    else if (fn === 'feeTerms') value = [30, args[1] ? p().buyCreatorFeeBps : p().sellCreatorFeeBps];
    else if (fn === 'creatorRecipients') value = [p().creatorWallets, p().creatorSharesBps, 0n];
    else if (fn === 'launch') value = simulationRecord();
    else if (fn === 'execute') value = result;
    else if (fn === 'registerReviewedFamily') value = f.artifact.familyId;
    else if (fn === 'approveRevision') return '0x';
    else throw new Error(`Unhandled synthetic getter ${fn} at ${to}`);
    return encodeFunctionResult({ abi, functionName: fn, result: value });
  };
  const providers = [0, 1].map(i => ({ role: i ? 'secondary' : 'primary', providerId: `synthetic-${i}`, trustDomain: `fixture-${i}.invalid`, authentication: 'fixture', endpointCommitment: `sha256:${h(i + 400).slice(2)}`,
    rpc: rpcClient(`https://provider-${i}.invalid`, `fixture-${i}`, async (_url, init) => { const request = JSON.parse(init.body); return Response.json({ jsonrpc: '2.0', id: request.id, result: await rpc(request.method, request.params, i) }); }) }));
  return { providers, methods, mutations, blocks, receipts, txs, get state() { return state; }, setPlan(plan) { currentPlan = plan; }, sync(advance = false) { if (advance) head++; save(); },
    async mine(prepared, plan = currentPlan) {
      currentPlan = plan; const step = plan.steps[prepared.stepIndex], txHash = h(nextHash++); head++;
      state.eoaNonce = (BigInt(state.eoaNonce) + 1n).toString();
      if (step.kind === 'engine-family') state.family = true;
      if (step.kind === 'engine-revision') state.revision = true;
      if (step.kind === 'engine-approve') state.allowance = step.approval.amount;
      if (step.kind === 'engine-launch') {
        state.launched = simulationRecord();
        const parameters = step.arguments[0], context = { host, launchId: state.launched.launchId, token: state.launched.token, creator: plan.owner, quoteAsset: f.quote.address, feeCollector: host };
        const constructorArgs = encodeAbiParameters(api.moduleEngineConstructorParameters, [context, parameters.configuration]);
        state.engineRuntime = api.materializeModuleEngineRuntime(f.artifact.engine.runtimeTemplate, constructorArgs, f.artifact.engine.immutableRuntimeOffsets, f.artifact.engine.immutableConstructorOffsets);
      }
      const op = step.operation;
      if (['engine-launch', 'engine-execute'].includes(step.kind) && op.operationId !== h(0)) { state.actorNonce[plan.owner] = (BigInt(op.nonce) + 1n).toString(); if (op.inputAsset !== ZERO_ADDRESS && BigInt(op.inputAmount) > 0n) state.allowance = '0'; }
      save(); const block = blocks.get(hexQuantity(head)), tx = { ...prepared.request, input: prepared.request.data, hash: txHash, blockNumber: block.number, blockHash: block.hash };
      txs.set(txHash, tx); block.transactions.push(txHash); const logs = [];
      if (step.kind === 'engine-revision') logs.push(eventLog('EngineRevisionApproved', { revisionId: f.artifact.packageId, familyId: f.artifact.familyId, revision }, txHash, block));
      if (step.kind === 'engine-launch') {
        logs.push(eventLog('EngineLaunchBound', { ...state.launched, runtimeCodeHash: state.launched.engineCodeHash, economicsPolicyId: f.identity.economicsPolicyId }, txHash, block));
        logs.push(eventLog('EngineLaunchParametersBound', { launchId: state.launched.launchId, encodedParameters: encodeAbiParameters(api.moduleEngineLaunchParameters, [step.arguments[0]]) }, txHash, block));
      }
      if (['engine-launch', 'engine-execute'].includes(step.kind) && op.operationId !== h(0)) logs.push(eventLog('EngineOperationExecuted', { ...op, nonce: BigInt(op.nonce), inputAmount: BigInt(op.inputAmount), launchId: state.launched.launchId, outputAmount: BigInt(op.minimumOutput), resultHash: keccak256(result) }, txHash, block));
      logs.forEach((l,i) => { l.logIndex = hexQuantity(i); });
      receipts.set(txHash, { transactionHash: txHash, blockNumber: block.number, blockHash: block.hash, status: '0x1', gasUsed: '0x186a0', transactionIndex: '0x0', logs });
      return { ...jsonSafe(prepared), transactionHash: txHash };
    },
  };
}
