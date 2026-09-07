#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  decodeAbiParameters, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData,
  getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex, zeroAddress,
} from 'viem';

import { canonicalJson, need } from './core.mjs';
import { boundedPublicJson, exactJson, SOURCIFY_BASE, SOURCIFY_COMPILER, sourcifyPreflight, sourcifyNeedsRecompilation, validateSourcifySource } from './source-readback.mjs';
import { recompileSourcifyInput } from './source-recompile.mjs';
import { launchSourceWire } from './launch-source-shared.mjs';
import { alignPublishedImmutableIds, bindCheckpointEntry, bindNativeTokenIdentity, checkpointEntry, checkpointState, engineLaunchIdentity, engineResourceCommitment,
  nativeForwarderSalt, receiptEvent, releaseInventory, sourceProfile } from './launch-source-profiles.mjs';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const MAX = (1n << 256n) - 1n;
const STATE_SCHEMA = 'programmable.module-mode-launch-source-checkpoint.v1';
const FORWARDER_EVENT_ABI = parseAbi(['event LockedPositionFeeForwarderDeployed(address indexed forwarder,address indexed feeRecipient,bytes32 indexed salt,bytes32 configurationHash,address positionManager)']);
const FORWARDER_EVENT_TOPIC = keccak256(toHex('LockedPositionFeeForwarderDeployed(address,address,bytes32,bytes32,address)'));
const POSITION_TRANSFER_ABI = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const POSITION_TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));
const TARGETS = [
  { role: 'token', factory: 'tokenFactory', factoryFile: 'lib/uerc20-factory/src/factories/UERC20Factory.sol', factoryName: 'UERC20Factory', file: 'lib/uerc20-factory/src/tokens/UERC20.sol', name: 'UERC20' },
  { role: 'forwarder', factory: 'positionForwarderFactory', factoryFile: 'src/LockedPositionFeeForwarderFactoryV1.sol', factoryName: 'LockedPositionFeeForwarderFactoryV1', file: 'lib/liquidity-launcher/src/periphery/PositionFeesForwarder.sol', name: 'PositionFeesForwarder' },
];
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const word = value => {
  const hex = typeof value === 'bigint' ? value.toString(16) : value.replace(/^0x/, '').toLowerCase();
  need(/^[0-9a-f]{1,64}$/.test(hex), 'Invalid immutable value');
  return hex.padStart(64, '0');
};

export function parseOptions(argv) {
  const result = { publish: false, maxBlocks: 1_000_000n, maxLaunches: 100, solc: 'solc' };
  const keys = { '--state-file': 'stateFile', '--output': 'output', '--from-block': 'fromBlock', '--to-block': 'toBlock', '--max-blocks': 'maxBlocks', '--max-launches': 'maxLaunches', '--token': 'token', '--solc': 'solc' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--publish') { need(!result.publish, 'Duplicate --publish'); result.publish = true; continue; }
    const key = keys[argv[i]];
    need(key && argv[i + 1] && !argv[i + 1].startsWith('--'), `Unknown or incomplete option: ${argv[i]}`);
    const value = argv[++i];
    result[key] = ['fromBlock', 'toBlock', 'maxBlocks'].includes(key) ? BigInt(value) : key === 'maxLaunches' ? Number(value) : value;
  }
  need(result.maxBlocks > 0n && result.maxBlocks <= 1_000_000n, '--max-blocks must be between 1 and 1000000');
  need(Number.isSafeInteger(result.maxLaunches) && result.maxLaunches > 0 && result.maxLaunches <= 1000, '--max-launches must be between 1 and 1000');
  need((result.fromBlock === undefined || result.fromBlock >= 0n) && (result.toBlock === undefined || result.toBlock >= 0n)
    && (result.fromBlock === undefined || result.toBlock === undefined || result.fromBlock <= result.toBlock), 'Invalid scan block range');
  need(!result.token || /^0x[0-9a-f]{40}$/i.test(result.token), 'Invalid token address');
  need(!result.stateFile || result.publish, 'Checkpoint changes require --publish');
  need(!result.stateFile || (!result.token && result.fromBlock === undefined && result.toBlock === undefined), 'Checkpoint runs cannot override their scan range or token');
  return result;
}

export function scanRange(release, options, finalized, checkpoint) {
  const start = BigInt(release.startBlock);
  if (checkpoint?.schemaVersion === STATE_SCHEMA) need((release.sourceVersion === undefined || release.sourceVersion === 'module-native-v1') && checkpoint.chainId === release.chainId
    && checkpoint.releaseDigest === release.releaseDigest && same(checkpoint.launcher, release.contracts.launcher.address)
    && /^0x[0-9a-f]{64}$/i.test(checkpoint.blockHash), 'Checkpoint belongs to a different release or lacks its block hash');
  else if (checkpoint) bindCheckpointEntry(checkpoint, release);
  const from = checkpoint ? BigInt(checkpoint.nextBlock) : options.fromBlock ?? start;
  need(from >= start && from >= 0n, 'Scan cannot precede the active launch source');
  const wanted = options.toBlock ?? finalized;
  need(wanted <= finalized, 'Scan cannot include unfinalized blocks');
  const to = wanted < from + options.maxBlocks - 1n ? wanted : from + options.maxBlocks - 1n;
  return { from, to, finalized, caughtUp: to === finalized };
}

export function patchImmutables(artifact, compilation, values) {
  const names = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.nodeType === 'VariableDeclaration' && node.mutability === 'immutable') names.set(String(node.id), node.name);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  Object.values(compilation.sources).forEach(source => visit(source.ast));
  let code = artifact.evm.deployedBytecode.object;
  const used = new Set();
  for (const [id, references] of Object.entries(artifact.evm.deployedBytecode.immutableReferences ?? {})) {
    const name = names.get(id);
    need(name && Object.hasOwn(values, name), `Unexpected immutable: ${name ?? id}`);
    used.add(name);
    for (const reference of references) {
      need(reference.length === 32 && reference.start >= 0 && (reference.start + 32) * 2 <= code.length, 'Invalid compiler immutable offset');
      code = code.slice(0, reference.start * 2) + word(values[name]) + code.slice((reference.start + 32) * 2);
    }
  }
  need(Object.keys(values).every(name => used.has(name)), 'Expected immutable is absent from the compilation');
  return `0x${code}`;
}

export function boundLaunchBatch(logs, range, maximum) {
  if (logs.length <= maximum) return logs;
  const end = BigInt(logs[maximum].blockNumber) - 1n;
  need(end >= range.from, 'A single block exceeds the launch budget; increase --max-launches');
  range.to = end;
  range.caughtUp = end === range.finalized;
  return logs.filter(log => BigInt(log.blockNumber) <= end);
}

export function validatePublished(target, value, recompilation) {
  need(target.creation && same(target.creation.transactionHash, target.transactionHash)
    && same(target.creationCode, `0x${target.artifact.evm.bytecode.object}${target.constructorArguments.slice(2)}`), 'Actual creation binding required');
  const artifact = { compilationTarget: { [target.file]: target.name }, abi: target.artifact.abi,
    bytecode: { ...target.artifact.evm.bytecode, object: `0x${target.artifact.evm.bytecode.object}` },
    deployedBytecode: { ...target.artifact.evm.deployedBytecode, object: `0x${target.artifact.evm.deployedBytecode.object}` },
    metadata: JSON.parse(target.artifact.metadata) };
  let input = target.input, compilerDefaultBinding;
  // solc metadata always emits libraries:{}, while a historical Sourcify input may omit that
  // empty default. Bind only this representation after recompiling the unmodified provider input.
  // Nonempty libraries, links, metadata and every executable byte retain the shared strict checks.
  if (input.settings.libraries && typeof input.settings.libraries === 'object'
    && !Array.isArray(input.settings.libraries) && Object.keys(input.settings.libraries).length === 0
    && !Object.hasOwn(value.compilation?.compilerSettings ?? {}, 'libraries')
    && !Object.hasOwn(value.stdJsonInput?.settings ?? {}, 'libraries')) {
    need(recompilation?.compilerVersion === SOURCIFY_COMPILER
      && recompilation.inputDigest === keccak256(toHex(canonicalJson(value.stdJsonInput)))
      && same(recompilation.creationBytecode, artifact.bytecode.object)
      && same(recompilation.runtimeBytecode, artifact.deployedBytecode.object)
      && canonicalJson(recompilation.abi) === canonicalJson(artifact.abi)
      && Object.keys(artifact.bytecode.linkReferences ?? {}).length === 0
      && Object.keys(artifact.deployedBytecode.linkReferences ?? {}).length === 0, 'Empty-library default requires exact pinned recompilation');
    const { libraries, ...settings } = input.settings;
    input = { ...input, settings }; compilerDefaultBinding = 'omitted-empty-library-map-after-exact-recompilation';
  }
  const aligned = alignPublishedImmutableIds(value);
  const result = validateSourcifySource({ role: target.role, sourceProfile: target.sourceProfile,
    plan: { sourceCommit: target.sourceCommit, contracts: { [target.role]: { address: target.address, runtime: target.runtime, runtimeCodeHash: keccak256(target.runtime) } } },
    build: { artifacts: { [target.role]: artifact }, standardInputs: { [target.role]: input } },
    constructorArguments: target.constructorArguments, creation: target.creation, recompilation }, aligned.value);
  return { ...result, ...(target.sourceProfile === 'module-engine-v1' ? { sourceCommit: undefined, releaseSourceCommit: target.sourceCommit,
    providerClassification: 'NO_METADATA_HASH_PROVIDER_MATCH' } : {}),
    sourceUrl: `${SOURCIFY_BASE}/v2/contract/4663/${target.address}`, comparison: result.independentByteComparison,
    ...(Object.keys(aligned.bindings).length ? { providerImmutableIdRelabelling: aligned.bindings } : {}),
    ...(compilerDefaultBinding ? { providerCompilerDefaultBinding: compilerDefaultBinding } : {}),
    creationBlockNumber: target.creation.blockNumber, creationBlockHash: target.creation.blockHash,
    creationTransactionIndex: target.creation.transactionIndex };
}

export async function resolveCreationTransactions({ release, launch, launchLog, launchReceipt, salt, factoryDeploymentBlock, configurationHash }, request = rpcBatch) {
  const factory = release.contracts.positionForwarderFactory.address;
  const positionManager = release.contracts.positionManager.address;
  const expectedConfiguration = keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,address,address,address,uint256,address'),
    [4663n, factory, launch.positionRecipient, positionManager, zeroAddress, MAX, launch.launchWallet]));
  need(same(configurationHash, expectedConfiguration), 'Forwarder factory configuration differs');
  const firstBlock = BigInt(factoryDeploymentBlock), lastBlock = BigInt(launchLog.blockNumber);
  need(firstBlock >= 0n && firstBlock <= lastBlock, 'Invalid forwarder creation lookup range');
  const topics = [FORWARDER_EVENT_TOPIC, `0x${word(launch.positionRecipient)}`, `0x${word(launch.launchWallet)}`, salt];
  const matches = log => same(log.address, factory) && same(log.topics?.[0], FORWARDER_EVENT_TOPIC)
    && same(log.topics?.[1], topics[1]);
  let logs = launchReceipt.logs.filter(matches);
  if (!logs.length) {
    // The permissionless factory may create the predicted forwarder before the launch.
    // One indexed lookup spans only the factory's lifetime up to this finalized launch.
    [logs] = await request([{ method: 'eth_getLogs', params: [{ address: factory, fromBlock: toHex(firstBlock), toBlock: toHex(lastBlock), topics }] }]);
  }
  need(Array.isArray(logs) && logs.length === 1, 'Forwarder must have exactly one factory creation event');
  const log = logs[0];
  need(matches(log) && log.removed === false && BigInt(log.blockNumber) >= firstBlock && BigInt(log.blockNumber) <= lastBlock,
    'Forwarder creation event is outside its canonical factory range');
  need(BigInt(log.blockNumber) < lastBlock || BigInt(log.logIndex) < BigInt(launchLog.logIndex), 'Forwarder creation must precede the launch');
  const event = decodeEventLog({ abi: FORWARDER_EVENT_ABI, topics: log.topics, data: log.data }).args;
  need(same(event.forwarder, launch.positionRecipient) && same(event.feeRecipient, launch.launchWallet) && same(event.salt, salt)
    && same(event.configurationHash, expectedConfiguration) && same(event.positionManager, positionManager), 'Forwarder creation event configuration differs');
  let receipt = launchReceipt;
  if (!same(log.transactionHash, launchLog.transactionHash)) {
    const [creationReceipt, block] = await request([
      { method: 'eth_getTransactionReceipt', params: [log.transactionHash] },
      { method: 'eth_getBlockByNumber', params: [log.blockNumber, false] },
    ]);
    need(block?.hash === log.blockHash && BigInt(block.number) === BigInt(log.blockNumber), 'Forwarder creation block is no longer canonical');
    receipt = creationReceipt;
  }
  need(receipt?.status === '0x1' && same(receipt.transactionHash, log.transactionHash) && receipt.blockHash === log.blockHash
    && BigInt(receipt.blockNumber) === BigInt(log.blockNumber) && Array.isArray(receipt.logs)
    && receipt.logs.some(item => same(item.address, factory) && item.logIndex === log.logIndex && item.data === log.data
      && canonicalJson(item.topics) === canonicalJson(log.topics)), 'Forwarder creation receipt differs from its factory event');
  return { token: launchLog.transactionHash, forwarder: log.transactionHash };
}

async function rpcBatch(calls) {
  const body = JSON.stringify(calls.map((call, id) => ({ jsonrpc: '2.0', id, ...call })));
  let response;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, attempt ? 1000 * 2 ** (attempt - 1) : 250));
    response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000), body });
    if (![429, 502, 503, 504].includes(response.status)) break;
  }
  need(response.ok, `Public RPC unavailable (HTTP ${response.status})`);
  const values = await response.json();
  need(Array.isArray(values) && values.length === calls.length && new Set(values.map(value => value.id)).size === calls.length, 'Incomplete RPC batch');
  return calls.map((call, id) => { const value = values.find(item => item.id === id);
    need(value && !value.error && value.result !== undefined, `Public RPC ${call.method} failed at request ${id}: ${String(value?.error?.message ?? 'missing response').slice(0, 200)}`);
    return value.result; });
}
function call(to, signature, args = [], block) {
  const abi = parseAbi([signature]);
  return { abi, method: 'eth_call', params: [{ to, data: encodeFunctionData({ abi, args }) }, block] };
}
async function readCalls(calls, request = rpcBatch, block) {
  const values = await request(calls.map(({ method, params }) => {
    const reference = block ?? params[1];
    need(typeof reference === 'string' && /^0x[0-9a-f]+$/i.test(reference)
      || reference?.requireCanonical === true && /^0x[0-9a-f]{64}$/i.test(reference.blockHash), 'Explicit canonical state reference required');
    return { method, params: [params[0], reference] };
  }));
  return values.map((value, i) => calls[i].abi ? decodeFunctionResult({ abi: calls[i].abi, data: value }) : value);
}
export async function compile(input, binary) {
  const encoded = JSON.stringify(input);
  need(Buffer.byteLength(encoded) <= 16 * 1024 * 1024, 'Compiler input is too large');
  const stdout = await new Promise((resolve, reject) => {
    const child = execFile(binary, ['--standard-json', '--no-import-callback'], { timeout: 45000, maxBuffer: 32 * 1024 * 1024 }, (error, output) => error ? reject(new Error('Pinned source compilation failed')) : resolve(output));
    child.stdin.on('error', () => {}); child.stdin.end(encoded);
  });
  const result = exactJson(Buffer.from(stdout), 'Compiler result');
  need(!(result.errors ?? []).some(error => error.severity === 'error'), 'Published source does not compile');
  return result;
}
export function sourceTarget(target, input, result) {
  const artifact = result.contracts?.[target.file]?.[target.name];
  need(artifact?.metadata && artifact.evm?.bytecode?.object && artifact.evm?.deployedBytecode?.object, 'Required deployment source is missing');
  // These are solc's actual target closure/settings, not a second source-packet interpretation.
  const metadata = JSON.parse(artifact.metadata), sourcePaths = Object.keys(metadata.sources);
  need(sourcePaths.includes(target.file) && sourcePaths.every(file => input.sources[file]), 'Compiler source closure is incomplete');
  const { compilationTarget, ...settings } = metadata.settings;
  need(canonicalJson(compilationTarget) === canonicalJson({ [target.file]: target.name }), 'Compiler target differs');
  const targetInput = { language: input.language, sources: Object.fromEntries(sourcePaths.map(file => [file, input.sources[file]])),
    settings: { ...settings, outputSelection: input.settings.outputSelection } };
  return { ...target, input: targetInput, compilation: result, artifact };
}
async function templates(release, codes, binary, fetchPublic = fetch, targets = TARGETS) {
  const version = await exec(binary, ['--version'], { timeout: 10000, maxBuffer: 4096 });
  need(version.stdout.includes(`Version: ${SOURCIFY_COMPILER}`), `solc ${SOURCIFY_COMPILER} is required`);
  return Promise.all(targets.map(async target => {
    const pin = release.contracts[target.factory];
    const { value: source } = await boundedPublicJson(`${SOURCIFY_BASE}/v2/contract/4663/${pin.address}?fields=all`, fetchPublic);
    need(source.chainId === '4663' && same(source.address, pin.address) && source.creationMatch === 'match' && source.runtimeMatch === 'match', 'Factory source identity is not verified');
    need(source.compilation?.compilerVersion === SOURCIFY_COMPILER && same(source.runtimeBytecode?.onchainBytecode, codes[target.factory]), 'Factory source/runtime differs from the active release');
    const input = { ...source.stdJsonInput, settings: { ...source.stdJsonInput.settings, outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode', 'evm.deployedBytecode'], '': ['ast'] } } } };
    const result = await compile(input, binary);
    const factoryArtifact = result.contracts?.[target.factoryFile]?.[target.factoryName];
    const artifact = result.contracts?.[target.file]?.[target.name];
    need(factoryArtifact && artifact, 'Required factory or deployment source is missing');
    const factoryRuntime = patchImmutables(factoryArtifact, result, target.factory === 'tokenFactory' ? {} : { positionManager: release.contracts.positionManager.address });
    need(same(factoryRuntime, codes[target.factory]), 'Recompiled factory does not match the active release');
    if (target.role === 'token') need(keccak256(`0x${artifact.evm.bytecode.object}`) === release.tokenCreationCodeHash, 'Token creation code differs from release commitment');
    need(/^[1-9][0-9]*$/.test(source.deployment?.blockNumber), 'Verified factory deployment block is unavailable');
    return { ...sourceTarget(target, input, result), factoryAbi: factoryArtifact.abi, sourceCommit: release.sourceCommit,
      factoryDeploymentBlock: BigInt(source.deployment.blockNumber) };
  }));
}

export async function creationEvidence(transactionHash, request = rpcBatch) {
  const [receipt, transaction] = await request([{ method: 'eth_getTransactionReceipt', params: [transactionHash] },
    { method: 'eth_getTransactionByHash', params: [transactionHash] }]);
  need(receipt?.status === '0x1' && same(receipt.transactionHash, transactionHash) && same(transaction?.hash, transactionHash)
    && transaction.blockHash === receipt.blockHash && BigInt(transaction.blockNumber) === BigInt(receipt.blockNumber)
    && BigInt(transaction.transactionIndex) === BigInt(receipt.transactionIndex) && /^0x[0-9a-f]{40}$/i.test(transaction.from)
    && Array.isArray(receipt.logs), 'Actual successful creation receipt/transaction required');
  const [block] = await request([{ method: 'eth_getBlockByNumber', params: [receipt.blockNumber, false] }]);
  need(block?.hash === receipt.blockHash && BigInt(block.number) === BigInt(receipt.blockNumber), 'Creation block is no longer canonical');
  return { receipt, creation: { transactionHash: transactionHash.toLowerCase(), blockNumber: BigInt(receipt.blockNumber).toString(),
    blockHash: receipt.blockHash, transactionIndex: BigInt(receipt.transactionIndex).toString(), transactionSender: transaction.from.toLowerCase() } };
}
function assertLaunchReceipt(log, receipt) {
  need(receipt?.status === '0x1' && same(receipt.transactionHash, log.transactionHash) && receipt.blockHash === log.blockHash
    && BigInt(receipt.blockNumber) === BigInt(log.blockNumber) && receipt.logs.some(item => same(item.address, log.address)
      && item.removed === false && item.logIndex === log.logIndex && item.data === log.data
      && canonicalJson(item.topics) === canonicalJson(log.topics)), 'Launch receipt differs from its scanned event');
}
function tokenCreationEvent(receipt, log, build, factory, token) {
  const declaration = build.factoryAbi.find(item => item.type === 'event' && item.name === 'TokenCreated');
  need(declaration?.inputs?.[0]?.type === 'address', 'Token factory creation ABI unavailable');
  const matches = receipt.logs.filter(item => same(item.address, factory)).flatMap(item => {
    try { const event = decodeEventLog({ abi: [declaration], topics: item.topics, data: item.data, strict: true });
      return same(event.args[declaration.inputs[0].name], token) ? [item] : []; } catch { return []; }
  });
  need(matches.length === 1 && matches[0].removed === false && matches[0].blockHash === log.blockHash
    && same(matches[0].transactionHash, log.transactionHash) && BigInt(matches[0].logIndex) < BigInt(log.logIndex), 'Token lacks its actual factory creation event');
}
export function bindPositionMint(receipt, launchLog, positionManager, tokenId, recipient) {
  const logs = receipt.logs.filter(log => same(log.address, positionManager) && log.topics?.length === 4
    && same(log.topics[0], POSITION_TRANSFER_TOPIC) && same(log.topics[3], `0x${word(tokenId)}`));
  need(logs.length === 1, 'Position lacks its unique mint event');
  const log = logs[0], args = decodeEventLog({ abi: POSITION_TRANSFER_ABI, topics: log.topics, data: log.data, strict: true }).args;
  need(log.removed === false && same(log.transactionHash, launchLog.transactionHash) && log.blockHash === launchLog.blockHash
    && BigInt(log.blockNumber) === BigInt(launchLog.blockNumber) && BigInt(log.logIndex) < BigInt(launchLog.logIndex)
    && same(args.from, zeroAddress) && same(args.to, recipient) && args.tokenId === tokenId, 'Position mint recipient/receipt differs');
}

export async function bindNativeLaunch(release, log, builds, { wire, request = rpcBatch, stateBlock = log.blockNumber }) {
  need(same(log.address, release.contracts.launcher.address) && log.removed === false, 'Launch log is not canonical');
  const launch = decodeEventLog({ abi: sourceProfile(release, wire).abi, eventName: 'ModuleNativeLaunched', data: log.data, topics: log.topics, strict: true }).args;
  need(same(launch.hook, release.contracts.hook.address), 'Launch hook differs from the active source');
  const c = release.contracts;
  const pool = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [zeroAddress, launch.token, 0, 200, c.hook.address]));
  need(pool === launch.poolId, 'Launch pool identity differs');
  const { receipt, creation } = await creationEvidence(log.transactionHash, request);
  assertLaunchReceipt(log, receipt);
  tokenCreationEvent(receipt, log, builds.find(build => build.role === 'token'), c.tokenFactory.address, launch.token);
  bindPositionMint(receipt, log, c.positionManager.address, launch.positionTokenId, launch.positionRecipient);
  const [name, symbol, decimals, creator, graffiti, tokenRuntime, operator, timelock, recipient, pm, configurationHash, forwarderRuntime] = await readCalls([
    call(launch.token, 'function name() view returns (string)'), call(launch.token, 'function symbol() view returns (string)'),
    call(launch.token, 'function decimals() view returns (uint8)'), call(launch.token, 'function creator() view returns (address)'), call(launch.token, 'function graffiti() view returns (bytes32)'),
    { method: 'eth_getCode', params: [launch.token, stateBlock] },
    call(launch.positionRecipient, 'function operator() view returns (address)'), call(launch.positionRecipient, 'function timelockBlockNumber() view returns (uint256)'),
    call(launch.positionRecipient, 'function feeRecipient() view returns (address)'), call(launch.positionRecipient, 'function positionManager() view returns (address)'),
    call(c.positionForwarderFactory.address, 'function configurationHashOf(address) view returns (bytes32)', [launch.positionRecipient]),
    { method: 'eth_getCode', params: [launch.positionRecipient, stateBlock] },
  ], request, stateBlock);
  need(same(creator, c.launcher.address) && decimals === 18, 'Token identity differs from the native source');
  need(same(operator, zeroAddress) && timelock === MAX && same(recipient, launch.launchWallet) && same(pm, c.positionManager.address), 'LP immutable custody policy differs from the native launch');
  const tokenSalt = keccak256(encodeAbiParameters(parseAbiParameters('string,string,uint8,address,bytes32'), [name, symbol, decimals, creator, graffiti]));
  need(same(getCreate2Address({ from: c.tokenFactory.address, salt: tokenSalt, bytecodeHash: release.tokenCreationCodeHash }), launch.token), 'Token factory CREATE2 identity differs');
  if (release.sourceVersion === 'module-native-v2') {
    const identity = bindNativeTokenIdentity(release, launch, receipt, graffiti);
    need(BigInt(identity.logIndex) > BigInt(log.logIndex), 'V2 token identity event precedes launch');
  }
  const forwarderSalt = nativeForwarderSalt(release, launch.token);
  const args = encodeAbiParameters(parseAbiParameters('address,address,uint256,address'), [pm, zeroAddress, MAX, launch.launchWallet]);
  const creationTransactions = await resolveCreationTransactions({ release, launch, launchLog: log, launchReceipt: receipt, salt: forwarderSalt,
    factoryDeploymentBlock: builds.find(build => build.role === 'forwarder').factoryDeploymentBlock, configurationHash }, request);
  const forwarderCreation = same(creationTransactions.forwarder, log.transactionHash) ? creation
    : (await creationEvidence(creationTransactions.forwarder, request)).creation;
  return builds.map(build => {
    const token = build.role === 'token';
    const values = token ? { _nameHash: keccak256(toHex(name)), graffiti, creator, _decimals: 18n }
      : { _USE_ARB_SYS: 1n, feeRecipient: recipient, positionManager: pm, operator: zeroAddress, timelockBlockNumber: MAX };
    const runtime = token ? tokenRuntime : forwarderRuntime;
    need(same(patchImmutables(build.artifact, build.compilation, values), runtime), `${build.role}: complete runtime differs from the pinned source`);
    const creationCode = `0x${build.artifact.evm.bytecode.object}${token ? '' : args.slice(2)}`;
    const address = token ? launch.token : launch.positionRecipient;
    if (!token) need(same(getCreate2Address({ from: c.positionForwarderFactory.address, salt: forwarderSalt, bytecodeHash: keccak256(creationCode) }), address), 'Forwarder factory CREATE2 identity differs');
    return { ...build, address, runtime, creationCode, constructorArguments: token ? '0x' : args,
      transactionHash: creationTransactions[build.role], creation: token ? creation : forwarderCreation };
  });
}

export async function engineBuild(entry, publication, context) {
  const { wire, fetchPublic, binary } = context, { release } = entry;
  const packageId = publication.template.manifest.manifest.revision.packageId;
  const request = { packageId, fetchPublic, signal: AbortSignal.timeout(60000), budget: { bytes: 0 } };
  const source = await wire.readPublication({ ...request, kind: 'source' });
  const manifest = await wire.readPublication({ ...request, kind: 'manifest' });
  const review = await wire.readPublication({ ...request, kind: 'review' });
  wire.verifyModuleEnginePublication({ release, publication, source, manifest, review });
  const reviewed = publication.reviewedBuild, expected = reviewed.artifact.engine;
  const standard = wire.moduleEngineStandardInputV1(source, reviewed.subject, reviewed.plan);
  need(wire.reviewDigest('programmable.modules.compiler-input.v1', standard) === reviewed.artifact.compiler.completeInputHash, 'Engine compiler input differs from accepted build');
  const input = { ...standard, settings: { ...standard.settings,
    outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode', 'evm.deployedBytecode'], '': ['ast'] } } } };
  const result = await compile(input, binary), target = sourceTarget({ role: 'engine', file: expected.sourcePath,
    name: expected.contractName, sourceCommit: release.sourceCommit, sourceProfile: 'module-engine-v1' }, input, result);
  need(same(`0x${target.artifact.evm.bytecode.object}`, expected.creationBytecode)
    && same(`0x${target.artifact.evm.deployedBytecode.object}`, expected.runtimeTemplate)
    && canonicalJson(target.artifact.abi) === canonicalJson(expected.abi)
    && canonicalJson(target.artifact.evm.deployedBytecode.immutableReferences ?? {})
      === canonicalJson(Object.fromEntries(expected.immutableReferences.map(({ id, ranges }) => [id, ranges]))), 'Local Engine compilation differs from accepted artifact');
  return target;
}

async function quoteResources(identity, release, log, receipt, creation, context) {
  const { request, fetchPublic, binary } = context, { launch: a, parameters: p } = identity;
  const configurationAbi = parseAbiParameters('(address poolManager,address positionManager,address positionPlanner,address positionForwarderFactory,address converter,bytes32 converterCodeHash,uint256 initialQuotePerTokenX18,address fixedQuoteAsset,bytes feeConversionRouteSuffix)');
  const [config] = decodeAbiParameters(configurationAbi, p.configuration);
  need(same(encodeAbiParameters(configurationAbi, [config]), p.configuration) && same(config.poolManager, release.contracts.poolManager.address), 'Quote resource configuration differs');
  const addresses = ['poolManager', 'positionManager', 'positionPlanner', 'positionForwarderFactory', 'converter'];
  const fields = [['poolId', 'bytes32'], ['positionTokenId', 'uint256'], ['positionRecipient', 'address'], ['initialAbsoluteTick', 'int24'], ['quoteDecimals', 'uint8'], ['lockedTokenDust', 'uint256']];
  const values = await readCalls([
    ...fields.map(([name, type]) => call(a.engine, `function ${name}() view returns (${type})`)),
    ...addresses.map(name => call(a.engine, `function ${name}() view returns (address)`)),
    ...addresses.map(name => call(a.engine, `function ${name}CodeHash() view returns (bytes32)`)),
    ...addresses.map(name => ({ method: 'eth_getCode', params: [config[name], context.stateBlock] })),
  ], request, context.stateBlock);
  const state = Object.fromEntries(fields.map(([name], i) => [name, values[i]]));
  const code = {};
  addresses.forEach((name, i) => {
    const actual = values[fields.length + addresses.length * 2 + i];
    need(same(values[fields.length + i], config[name]) && actual !== '0x'
      && same(values[fields.length + addresses.length + i], keccak256(actual)), `Quote ${name} source binding differs`);
    code[name] = actual;
  });
  need(same(keccak256(code.converter), config.converterCodeHash)
    && same(keccak256(code.poolManager), release.contracts.poolManager.runtimeCodeHash), 'Quote dependency code differs');
  engineResourceCommitment(identity, state);
  const initialized = receiptEvent(receipt, context.wire.moduleEngineResourcesAbi, config.poolManager, 'Initialize', state.poolId);
  const initialTick = a.quoteAsset.toLowerCase() < a.token.toLowerCase() ? state.initialAbsoluteTick : -state.initialAbsoluteTick;
  need(BigInt(initialized.log.logIndex) < BigInt(log.logIndex) && same(initialized.args.hooks, a.engine)
    && initialized.args.fee === 0 && initialized.args.tickSpacing === 200 && initialized.args.tick === initialTick
    && same(initialized.args.currency0, a.quoteAsset.toLowerCase() < a.token.toLowerCase() ? a.quoteAsset : a.token)
    && same(initialized.args.currency1, a.quoteAsset.toLowerCase() < a.token.toLowerCase() ? a.token : a.quoteAsset), 'Quote pool lacks its actual initialization event');
  bindPositionMint(receipt, log, config.positionManager, state.positionTokenId, state.positionRecipient);
  const [operator, timelock, recipient, pm, configurationHash, runtime, actualDecimals, pool] = await readCalls([
    call(state.positionRecipient, 'function operator() view returns (address)'), call(state.positionRecipient, 'function timelockBlockNumber() view returns (uint256)'),
    call(state.positionRecipient, 'function feeRecipient() view returns (address)'), call(state.positionRecipient, 'function positionManager() view returns (address)'),
    call(config.positionForwarderFactory, 'function configurationHashOf(address) view returns (bytes32)', [state.positionRecipient]),
    { method: 'eth_getCode', params: [state.positionRecipient, context.stateBlock] }, call(a.quoteAsset, 'function decimals() view returns (uint8)'),
    call(a.engine, 'function poolKey() view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))'),
  ], request, context.stateBlock);
  const currencies = [a.token, a.quoteAsset].map(x => x.toLowerCase()).sort();
  need(same(operator, zeroAddress) && timelock === MAX && same(recipient, a.creator)
    && same(pm, config.positionManager) && state.quoteDecimals === actualDecimals && same(pool.currency0, currencies[0])
    && same(pool.currency1, currencies[1]) && pool.fee === 0 && pool.tickSpacing === 200 && same(pool.hooks, a.engine), 'Quote pool/locked custody differs');
  const resourceRelease = { ...release, contracts: { ...release.contracts,
    positionManager: { address: config.positionManager }, positionForwarderFactory: { address: config.positionForwarderFactory, runtimeCodeHash: keccak256(code.positionForwarderFactory) } } };
  const [build] = await templates(resourceRelease, code, binary, fetchPublic, [TARGETS[1]]);
  const launch = { ...a, ...state, launchWallet: a.creator };
  const txs = await resolveCreationTransactions({ release: resourceRelease, launch, launchLog: log, launchReceipt: receipt,
    salt: a.launchId, factoryDeploymentBlock: build.factoryDeploymentBlock, configurationHash }, request);
  const constructorArguments = encodeAbiParameters(parseAbiParameters('address,address,uint256,address'), [pm, zeroAddress, MAX, a.creator]);
  const creationCode = `0x${build.artifact.evm.bytecode.object}${constructorArguments.slice(2)}`;
  need(same(getCreate2Address({ from: config.positionForwarderFactory, salt: a.launchId, bytecodeHash: keccak256(creationCode) }), state.positionRecipient)
    && same(patchImmutables(build.artifact, build.compilation, { _USE_ARB_SYS: 1n, feeRecipient: a.creator,
      positionManager: pm, operator: zeroAddress, timelockBlockNumber: MAX }), runtime), 'Quote forwarder creation/runtime differs');
  return { ...build, address: state.positionRecipient, runtime, creationCode, constructorArguments, transactionHash: txs.forwarder,
    creation: same(txs.forwarder, log.transactionHash) ? creation : (await creationEvidence(txs.forwarder, request)).creation,
    resources: { profile: 'quote-v1', resourcesHash: a.resourcesHash, poolId: state.poolId, positionTokenId: String(state.positionTokenId),
      dependencies: Object.fromEntries(addresses.map(name => [name, { address: config[name], runtimeCodeHash: keccak256(code[name]) }])) } };
}

async function bindEngineLaunch(entry, log, tokenBuild, context) {
  const { release } = entry, { wire, request } = context, host = release.contracts.host.address;
  need(same(log.address, host) && log.removed === false, 'Engine launch log is not canonical');
  const { receipt, creation } = await creationEvidence(log.transactionHash, request);
  assertLaunchReceipt(log, receipt);
  const emitted = receiptEvent(receipt, wire.moduleEngineHostAbi, host, 'EngineLaunchBound', log.topics[1]);
  const entries = wire.bindModuleEngineCatalogFile(entry.catalog, release).entries;
  const matches = entries.filter(publication => same(publication.template.manifest.manifest.revision.packageId, emitted.args.revisionId));
  need(matches.length === 1, 'Engine revision lacks an accepted protected publication');
  const publication = matches[0], key = `${release.releaseDigest}:${publication.requestDigest}`;
  if (!context.engineBuilds.has(key)) context.engineBuilds.set(key, await engineBuild(entry, publication, context));
  const build = context.engineBuilds.get(key);
  const hostRead = (name, args) => { const abi = wire.moduleEngineHostAbi.filter(item => item.type === 'function' && item.name === name);
    return { abi, method: 'eth_call', params: [{ to: host, data: encodeFunctionData({ abi, functionName: name, args }) }, context.stateBlock] }; };
  const [revision, stored] = await readCalls([hostRead('getRevision', [emitted.args.revisionId]), hostRead('getLaunch', [emitted.args.launchId])], request);
  for (const [name, value] of Object.entries(emitted.args)) if (name !== 'economicsPolicyId')
    need(same(stored[name === 'runtimeCodeHash' ? 'engineCodeHash' : name], value), `Engine stored ${name} differs`);
  const identity = engineLaunchIdentity({ release, receipt, log, publication, revision }, wire);
  const { launch: a, parameters: p } = identity;
  tokenCreationEvent(receipt, log, tokenBuild, release.contracts.tokenFactory.address, a.token);
  const [runtime, tokenRuntime, name, symbol, decimals, creator, graffiti, contextHash] = await readCalls([
    { method: 'eth_getCode', params: [a.engine, context.stateBlock] }, { method: 'eth_getCode', params: [a.token, context.stateBlock] },
    call(a.token, 'function name() view returns (string)'), call(a.token, 'function symbol() view returns (string)'), call(a.token, 'function decimals() view returns (uint8)'),
    call(a.token, 'function creator() view returns (address)'), call(a.token, 'function graffiti() view returns (bytes32)'), call(a.engine, 'function contextHash() view returns (bytes32)'),
  ], request, context.stateBlock);
  need(same(runtime, identity.runtime) && name === p.name && symbol === p.symbol && decimals === 18 && same(creator, host)
    && same(graffiti, identity.graffiti) && same(contextHash, keccak256(encodeAbiParameters([wire.moduleEngineConstructorParameters[0]], [identity.context]))), 'Engine/token runtime context differs');
  need(same(patchImmutables(tokenBuild.artifact, tokenBuild.compilation, { _nameHash: keccak256(toHex(name)), graffiti, creator, _decimals: 18n }), tokenRuntime), 'Engine token complete immutable runtime differs');
  const engine = { ...build, address: a.engine, runtime, constructorArguments: identity.constructorArguments, creationCode: identity.creationCode,
    creation, transactionHash: log.transactionHash, requestDigest: publication.requestDigest,
    manifestHash: publication.template.manifestHash, reviewDigest: publication.template.reviewDigest, artifactDigest: identity.manifest.source.artifactDigest };
  const token = { ...tokenBuild, address: a.token, runtime: tokenRuntime, constructorArguments: '0x', creationCode: `0x${tokenBuild.artifact.evm.bytecode.object}`, creation, transactionHash: log.transactionHash };
  if (identity.manifest.catalogDefinition.interface === 'quote-v1') return [token, engine, await quoteResources(identity, release, log, receipt, creation, context)];
  const fields = identity.manifest.catalogDefinition.interface === 'settlement-v1' ? ['minimumWindow', 'maximumWindow']
    : identity.manifest.catalogDefinition.interface === 'escrow-v1' ? ['unlockTime'] : [];
  const values = fields.length ? await readCalls(fields.map(name => call(a.engine, `function ${name}() view returns (uint256)`)), request, context.stateBlock) : [];
  const resourcesHash = engineResourceCommitment(identity, Object.fromEntries(fields.map((name, i) => [name, values[i]])));
  engine.resources = { profile: identity.manifest.catalogDefinition.interface, resourcesHash, additionalSourceTargets: [] };
  return [token, engine];
}

export async function ensurePublished(target, publish, { fetchPublic = fetch, binary = 'solc', beforePublish } = {}) {
  need(target.creation && same(target.creation.transactionHash, target.transactionHash) && target.runtime !== '0x'
    && same(target.creationCode, `0x${target.artifact.evm.bytecode.object}${target.constructorArguments.slice(2)}`), 'Bound source target required before publication');
  const url = `${SOURCIFY_BASE}/v2/contract/4663/${target.address}?fields=all`;
  async function read() {
    let missing = false;
    const response = await boundedPublicJson(url, async (...args) => {
      const result = await fetchPublic(...args); if (result.status !== 404) return result;
      await result.body?.cancel(); missing = true;
      return new Response('null', { headers: { 'content-type': 'application/json' } });
    });
    if (missing) return null;
    const recompilation = sourcifyNeedsRecompilation(target.input, response.value)
      ? await recompileSourcifyInput(response.value, target.input, { PATH: process.env.PATH, MODULE_MODE_SOLC: binary }) : undefined;
    return { ...validatePublished(target, response.value, recompilation), sourceResponseBytesDigest: keccak256(response.raw) };
  }
  const current = await read();
  if (current || !publish) return current ?? { role: target.role, address: target.address, status: 'not-published' };
  need(typeof beforePublish === 'function', 'Canonical creation/runtime snapshot recheck required before source publication');
  await beforePublish(target);
  const response = await fetchPublic(`${SOURCIFY_BASE}/v2/verify/4663/${target.address}`, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000), body: JSON.stringify({ stdJsonInput: target.input, compilerVersion: SOURCIFY_COMPILER, contractIdentifier: `${target.file}:${target.name}`, creationTransactionHash: target.transactionHash }) });
  need(response.status === 202, `Source publication rejected (HTTP ${response.status})`);
  const job = await response.json(); need(typeof job.verificationId === 'string', 'Missing source verification job');
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const result = await read(); if (result) return result;
    need(/^[A-Za-z0-9-]{1,128}$/.test(job.verificationId), 'Invalid source verification job');
    const { value } = await boundedPublicJson(`${SOURCIFY_BASE}/v2/verify/${job.verificationId}`, fetchPublic);
    if (value.isJobCompleted) throw new Error(`${target.role}: source verification finished without a verified readback`);
  }
  throw new Error(`${target.role}: source verification is still pending; the checkpoint was not advanced`);
}

async function readInventory(root, wire) {
  const paths = { native: ['config/module-mode/robinhood.preview.json', 'config/module-mode/catalog.json', 'config/module-mode/historical-releases.json'],
    engine: ['config/module-engine/robinhood.json', 'config/module-engine/catalog.json', 'config/module-engine/historical-releases.json'] };
  const files = {};
  for (const [kind, names] of Object.entries(paths)) {
    const [current, catalog, history] = await Promise.all(names.map(async name => exactJson(await readFile(path.join(root, name)), name)));
    files[kind] = { current, catalog, history };
  }
  return releaseInventory(files, wire);
}
export async function releaseCode(release, block, context) {
  const roles = Object.keys(release.contracts);
  const values = await context.request(roles.map(role => ({ method: 'eth_getCode', params: [release.contracts[role].address, block] })));
  const code = Object.fromEntries(roles.map((role, i) => {
    need(values[i] !== '0x' && same(keccak256(values[i]), release.contracts[role].runtimeCodeHash), `Released ${role} code hash differs at scan block`);
    return [role, values[i]];
  }));
  const engine = release.sourceVersion === 'module-engine-v1';
  const legacy = release.sourceVersion === 'module-native-v1';
  const [version] = await readCalls([call(release.contracts[engine ? 'host' : 'launcher'].address,
    engine ? 'function SOURCE_VERSION() view returns (bytes32)' : legacy ? 'function launchIdentityVersion() view returns (uint256)'
      : 'function sourceVersion() view returns (string)')], context.request, block);
  need(same(version, engine ? keccak256(toHex('programmable.module-engine.evm.v1')) : legacy ? 1n : release.sourceVersion), 'Released source version getter differs');
  return code;
}
async function writeCheckpoint(file, state) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(`${file}.tmp`, `${json(state)}\n`); await rename(`${file}.tmp`, file);
}

/** The same operator scans every protected current/historical release, with isolated digest checkpoints. */
export async function run(options, dependencies = {}) {
  const wire = await launchSourceWire(), inventory = await readInventory(dependencies.root ?? ROOT, wire);
  need(inventory.length > 0, 'An active or historical Module Mode source is required');
  const context = { wire, request: dependencies.request ?? rpcBatch, fetchPublic: dependencies.fetchPublic ?? fetch,
    binary: options.solc, engineBuilds: new Map() };
  let prior;
  if (options.stateFile) try { prior = exactJson(await readFile(options.stateFile), 'Source checkpoint'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = checkpointState(prior, inventory);
  const [chainId, finalized, head] = await context.request([{ method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['finalized', false] }, { method: 'eth_getBlockByNumber', params: ['latest', false] }]);
  need(BigInt(chainId) === 4663n && finalized?.number && /^0x[0-9a-f]{64}$/i.test(finalized.hash), 'Finalized Robinhood source unavailable');
  need(head?.number && /^0x[0-9a-f]{64}$/i.test(head.hash) && BigInt(head.number) >= BigInt(finalized.number), 'Canonical runtime snapshot unavailable');
  // Finalized logs/receipts remain available without archive state. All current immutable runtime/getter
  // reads use one EIP-1898 canonical hash, never a moving latest tag or a finalized-state assertion.
  context.stateBlock = { blockHash: head.hash, requireCanonical: true };
  context.stateNumber = head.number;
  context.beforePublish = async target => {
    const [creation, runtime] = await context.request([
      { method: 'eth_getBlockByNumber', params: [toHex(BigInt(target.creation.blockNumber)), false] },
      { method: 'eth_getBlockByNumber', params: [context.stateNumber, false] },
    ]);
    need(creation?.hash === target.creation.blockHash && BigInt(creation.number) === BigInt(target.creation.blockNumber)
      && BigInt(creation.number) <= BigInt(finalized.number), 'Finalized creation block changed before source publication');
    need(runtime?.hash === head.hash && BigInt(runtime.number) === BigInt(context.stateNumber), 'Canonical runtime snapshot changed before source publication');
  };
  const report = { schemaVersion: 'programmable.module-mode-launch-source-report.v2', checkedAt: new Date().toISOString(), chainId: 4663,
    publish: options.publish, observation: { provider: RPC,
      finalizedScan: { blockNumber: BigInt(finalized.number).toString(), blockHash: finalized.hash, blockTag: 'finalized' },
      runtimeSnapshot: { blockNumber: BigInt(head.number).toString(), blockHash: head.hash, requireCanonical: true, assurance: 'current-canonical-state-not-finalized-state' },
      assurance: 'single-public-rpc-observation-not-quorum-finality-proof' }, releases: [], records: [] };
  let remaining = options.maxLaunches, tokenMatches = 0, preflight = false;
  for (const entry of inventory) {
    const { release, profile } = entry, checkpoint = state.releases[release.releaseDigest];
    const record = { releaseDigest: release.releaseDigest, sourceVersion: release.sourceVersion, sourceAddress: profile.source, records: [] };
    report.releases.push(record);
    try {
      // A manual historical range may predate a newer release. Intersect it with each source's lifetime.
      const entryOptions = options.fromBlock !== undefined && options.fromBlock < BigInt(release.startBlock)
        ? { ...options, fromBlock: BigInt(release.startBlock) } : options;
      const range = scanRange(release, entryOptions, BigInt(finalized.number), checkpoint); record.range = range;
      if (checkpoint) {
        const [previous] = await context.request([{ method: 'eth_getBlockByNumber', params: [toHex(range.from - 1n), false] }]);
        need(previous?.hash === checkpoint.blockHash && BigInt(previous.number) === range.from - 1n, 'Checkpoint block is no longer canonical');
      }
      if (remaining === 0) { record.status = 'deferred-launch-budget'; continue; }
      if (range.from <= range.to) {
        const [scanEnd] = await context.request([{ method: 'eth_getBlockByNumber', params: [toHex(range.to), false] }]);
        need(/^0x[0-9a-f]{64}$/i.test(scanEnd?.hash) && BigInt(scanEnd.number) === range.to
          && (range.to !== BigInt(finalized.number) || scanEnd.hash === finalized.hash), 'Scan end differs from observed finalized chain');
        record.scanEndHash = scanEnd.hash;
        const topics = [profile.topic];
        if (options.token) { while (topics.length < profile.tokenTopic) topics.push(null); topics.push(`0x${word(options.token)}`); }
        let [logs] = await context.request([{ method: 'eth_getLogs', params: [{ address: profile.source, fromBlock: toHex(range.from), toBlock: toHex(range.to), topics }] }]);
        need(Array.isArray(logs) && logs.length <= 10000, 'Invalid or unbounded launch log response');
        logs.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
        need(new Set(logs.map(log => `${log.blockHash}:${log.transactionHash}:${log.logIndex}`)).size === logs.length, 'Duplicate launch logs');
        need(logs.every(log => same(log.address, profile.source) && log.removed === false && same(log.topics?.[0], profile.topic)
          && BigInt(log.blockNumber) >= range.from && BigInt(log.blockNumber) <= range.to
          && (!options.token || same(log.topics[profile.tokenTopic], `0x${word(options.token)}`))), 'Launch log is outside its source/range/token filter');
        if (options.token) tokenMatches += logs.length;
        logs = boundLaunchBatch(logs, range, remaining); remaining -= logs.length;
        if (BigInt(scanEnd.number) !== range.to) {
          const [boundedEnd] = await context.request([{ method: 'eth_getBlockByNumber', params: [toHex(range.to), false] }]);
          need(/^0x[0-9a-f]{64}$/i.test(boundedEnd?.hash) && BigInt(boundedEnd.number) === range.to, 'Bounded scan end is unavailable');
          record.scanEndHash = boundedEnd.hash;
        }
        if (logs.length) {
          const codes = await releaseCode(release, context.stateBlock, context);
          const builds = await templates(release, codes, options.solc, context.fetchPublic, profile.native ? TARGETS : [TARGETS[0]]);
          for (const log of logs) {
            const targets = profile.native ? await bindNativeLaunch(release, log, builds, context) : await bindEngineLaunch(entry, log, builds[0], context);
            const [stable, snapshot] = await context.request([{ method: 'eth_getBlockByNumber', params: [log.blockNumber, false] },
              { method: 'eth_getBlockByNumber', params: [context.stateNumber, false] }]);
            need(stable?.hash === log.blockHash && BigInt(stable.number) === BigInt(log.blockNumber), 'Launch block changed before source publication');
            need(snapshot?.hash === head.hash && BigInt(snapshot.number) === BigInt(context.stateNumber), 'State snapshot changed before source publication');
            // Every target and resource in this launch is bound before the first permitted publication.
            if (options.publish && !preflight) { await sourcifyPreflight(context.fetchPublic); preflight = true; }
            for (const target of targets) {
              const result = { ...await ensurePublished(target, options.publish, context), releaseDigest: release.releaseDigest,
                sourceVersion: release.sourceVersion, launchTransactionHash: log.transactionHash,
                ...(target.resources ? { resources: target.resources } : {}),
                ...(target.requestDigest ? { requestDigest: target.requestDigest, manifestHash: target.manifestHash,
                  reviewDigest: target.reviewDigest, artifactDigest: target.artifactDigest } : {}) };
              record.records.push(result); report.records.push(result);
            }
          }
        }
      }
      record.status = record.records.some(item => item.status === 'not-published') ? 'source-publication-required' : 'verified';
      if (options.stateFile && record.status === 'verified' && range.from <= range.to) {
        const [end, snapshot] = await context.request([{ method: 'eth_getBlockByNumber', params: [toHex(range.to), false] },
          { method: 'eth_getBlockByNumber', params: [context.stateNumber, false] }]);
        need(end?.hash === record.scanEndHash && BigInt(end.number) === range.to, 'Scan end block changed before checkpoint');
        need(snapshot?.hash === head.hash && BigInt(snapshot.number) === BigInt(context.stateNumber), 'State snapshot changed before checkpoint');
        state.releases[release.releaseDigest] = checkpointEntry(release, range.to + 1n, end.hash.toLowerCase(), report.checkedAt);
        await writeCheckpoint(options.stateFile, state);
      }
    } catch (error) { record.status = 'failed'; record.error = error.message; }
  }
  if (options.token && tokenMatches !== 1) report.selectionError = 'Token does not have exactly one launch across the source inventory and scan range';
  report.status = report.selectionError || report.releases.some(item => item.status === 'failed') ? 'failed'
    : report.releases.some(item => item.status === 'source-publication-required') ? 'source-publication-required' : 'verified';
  if (options.output) { await mkdir(path.dirname(path.resolve(options.output)), { recursive: true }); await writeFile(options.output, `${json(report)}\n`); }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await run(parseOptions(process.argv.slice(2)));
    process.stdout.write(`${json(report)}\n`);
    if (report.status !== 'verified') process.exitCode = 1;
  } catch (error) { process.stderr.write(`Module launch source verification failed: ${error.message}\n`); process.exitCode = 1; }
}
