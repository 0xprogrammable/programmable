#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData,
  getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex, zeroAddress,
} from 'viem';

import { canonicalJson, need } from './core.mjs';
import { boundedPublicJson, SOURCIFY_BASE, SOURCIFY_COMPILER, sourcifyPreflight } from './source-readback.mjs';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const MAX = (1n << 256n) - 1n;
const STATE_SCHEMA = 'programmable.module-mode-launch-source-checkpoint.v1';
const EVENT = 'event ModuleNativeLaunched(bytes32 indexed launchId,address indexed launchWallet,address indexed token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens)';
const EVENT_ABI = parseAbi([EVENT]);
const EVENT_TOPIC = keccak256(toHex('ModuleNativeLaunched(bytes32,address,address,bytes32,bytes32,address,address,uint256,uint256,uint256)'));
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
  need(!result.token || /^0x[0-9a-f]{40}$/i.test(result.token), 'Invalid token address');
  need(!result.stateFile || result.publish, 'Checkpoint changes require --publish');
  need(!result.stateFile || (!result.token && result.fromBlock === undefined && result.toBlock === undefined), 'Checkpoint runs cannot override their scan range or token');
  return result;
}

export function scanRange(release, options, finalized, checkpoint) {
  const start = BigInt(release.startBlock);
  if (checkpoint) need(checkpoint.schemaVersion === STATE_SCHEMA && checkpoint.chainId === release.chainId
    && checkpoint.releaseDigest === release.releaseDigest && same(checkpoint.launcher, release.contracts.launcher.address)
    && /^0x[0-9a-f]{64}$/i.test(checkpoint.blockHash), 'Checkpoint belongs to a different release or lacks its block hash');
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

export function validatePublished(target, value) {
  need(value?.chainId === '4663' && same(value.address, target.address), 'Published source chain/address differs');
  need(value.match === 'match' && value.creationMatch === 'match' && value.runtimeMatch === 'match', 'Published source has no creation/runtime match');
  need(value.compilation?.compilerVersion === SOURCIFY_COMPILER && value.compilation.fullyQualifiedName === `${target.file}:${target.name}`, 'Published compiler or target differs');
  need(canonicalJson(value.sources) === canonicalJson(target.input.sources), 'Published source closure differs');
  need(same(value.deployment?.transactionHash, target.transactionHash), 'Published creation transaction differs');
  need(same(value.creationBytecode?.onchainBytecode, target.creationCode) && same(value.creationBytecode?.recompiledBytecode, `0x${target.artifact.evm.bytecode.object}`), 'Published creation bytecode differs');
  need(same(value.runtimeBytecode?.onchainBytecode, target.runtime) && same(value.runtimeBytecode?.recompiledBytecode, `0x${target.artifact.evm.deployedBytecode.object}`), 'Published runtime bytecode differs');
  return { role: target.role, address: target.address, runtimeCodeHash: keccak256(target.runtime), sourceUrl: `${SOURCIFY_BASE}/v2/contract/4663/${target.address}`, providerMatch: value.match, creationMatch: value.creationMatch, runtimeMatch: value.runtimeMatch, verifiedAt: value.verifiedAt, comparison: 'exact-complete-creation-and-runtime' };
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
  return calls.map((_, id) => { const value = values.find(item => item.id === id); need(value && !value.error && value.result !== undefined, `Public RPC failed at request ${id}`); return value.result; });
}
function call(to, signature, args = []) {
  const abi = parseAbi([signature]);
  return { abi, method: 'eth_call', params: [{ to, data: encodeFunctionData({ abi, args }) }, 'latest'] };
}
async function readCalls(calls) {
  const values = await rpcBatch(calls.map(({ abi, ...request }) => request));
  return values.map((value, i) => calls[i].abi ? decodeFunctionResult({ abi: calls[i].abi, data: value }) : value);
}
async function compile(input, binary) {
  const encoded = JSON.stringify(input);
  need(Buffer.byteLength(encoded) <= 16 * 1024 * 1024, 'Compiler input is too large');
  const stdout = await new Promise((resolve, reject) => {
    const child = execFile(binary, ['--standard-json', '--no-import-callback'], { timeout: 45000, maxBuffer: 32 * 1024 * 1024 }, (error, output) => error ? reject(new Error('Pinned source compilation failed')) : resolve(output));
    child.stdin.on('error', () => {}); child.stdin.end(encoded);
  });
  const result = JSON.parse(stdout);
  need(!(result.errors ?? []).some(error => error.severity === 'error'), 'Published source does not compile');
  return result;
}
async function templates(release, codes, binary) {
  const version = await exec(binary, ['--version'], { timeout: 10000, maxBuffer: 4096 });
  need(version.stdout.includes(`Version: ${SOURCIFY_COMPILER}`), `solc ${SOURCIFY_COMPILER} is required`);
  return Promise.all(TARGETS.map(async target => {
    const pin = release.contracts[target.factory];
    const { value: source } = await boundedPublicJson(`${SOURCIFY_BASE}/v2/contract/4663/${pin.address}?fields=all`);
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
    // Sourcify stores the target's compiler metadata source closure, excluding unrelated factory files.
    const sourcePaths = Object.keys(JSON.parse(artifact.metadata).sources);
    need(sourcePaths.includes(target.file) && sourcePaths.every(file => input.sources[file]), 'Compiler source closure is incomplete');
    const targetInput = { ...input, sources: Object.fromEntries(sourcePaths.map(file => [file, input.sources[file]])) };
    return { ...target, input: targetInput, compilation: result, artifact };
  }));
}

async function bindLaunch(release, log, builds) {
  need(same(log.address, release.contracts.launcher.address) && log.removed === false, 'Launch log is not canonical');
  const launch = decodeEventLog({ abi: EVENT_ABI, data: log.data, topics: log.topics }).args;
  need(same(launch.hook, release.contracts.hook.address), 'Launch hook differs from the active source');
  const c = release.contracts;
  const pool = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [zeroAddress, launch.token, 0, 200, c.hook.address]));
  need(pool === launch.poolId, 'Launch pool identity differs');
  const [receipt] = await rpcBatch([{ method: 'eth_getTransactionReceipt', params: [log.transactionHash] }]);
  need(receipt?.status === '0x1' && receipt.blockHash === log.blockHash && receipt.logs.some(item => item.logIndex === log.logIndex && item.data === log.data && canonicalJson(item.topics) === canonicalJson(log.topics)), 'Launch receipt differs from the finalized log');
  const [name, symbol, decimals, creator, graffiti, tokenRuntime, owner, operator, timelock, recipient, pm, recognized, forwarderRuntime] = await readCalls([
    call(launch.token, 'function name() view returns (string)'), call(launch.token, 'function symbol() view returns (string)'),
    call(launch.token, 'function decimals() view returns (uint8)'), call(launch.token, 'function creator() view returns (address)'), call(launch.token, 'function graffiti() view returns (bytes32)'),
    { method: 'eth_getCode', params: [launch.token, 'latest'] }, call(c.positionManager.address, 'function ownerOf(uint256) view returns (address)', [launch.positionTokenId]),
    call(launch.positionRecipient, 'function operator() view returns (address)'), call(launch.positionRecipient, 'function timelockBlockNumber() view returns (uint256)'),
    call(launch.positionRecipient, 'function feeRecipient() view returns (address)'), call(launch.positionRecipient, 'function positionManager() view returns (address)'),
    call(c.positionForwarderFactory.address, 'function isFactoryForwarder(address) view returns (bool)', [launch.positionRecipient]),
    { method: 'eth_getCode', params: [launch.positionRecipient, 'latest'] },
  ]);
  need(same(creator, c.launcher.address) && decimals === 18, 'Token identity differs from the native source');
  need(same(owner, launch.positionRecipient) && same(operator, zeroAddress) && timelock === MAX && same(recipient, launch.launchWallet) && same(pm, c.positionManager.address) && recognized === true, 'LP custody differs from the native launch policy');
  const tokenSalt = keccak256(encodeAbiParameters(parseAbiParameters('string,string,uint8,address,bytes32'), [name, symbol, decimals, creator, graffiti]));
  need(same(getCreate2Address({ from: c.tokenFactory.address, salt: tokenSalt, bytecodeHash: release.tokenCreationCodeHash }), launch.token), 'Token factory CREATE2 identity differs');
  const forwarderSalt = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address'), ['programmable.module-mode.native-position.v1', 4663n, c.launcher.address, launch.token]));
  const args = encodeAbiParameters(parseAbiParameters('address,address,uint256,address'), [pm, zeroAddress, MAX, launch.launchWallet]);
  return builds.map(build => {
    const token = build.role === 'token';
    const values = token ? { _nameHash: keccak256(toHex(name)), graffiti, creator, _decimals: 18n }
      : { _USE_ARB_SYS: 1n, feeRecipient: recipient, positionManager: pm, operator: zeroAddress, timelockBlockNumber: MAX };
    const runtime = token ? tokenRuntime : forwarderRuntime;
    need(same(patchImmutables(build.artifact, build.compilation, values), runtime), `${build.role}: complete runtime differs from the pinned source`);
    const creationCode = `0x${build.artifact.evm.bytecode.object}${token ? '' : args.slice(2)}`;
    const address = token ? launch.token : launch.positionRecipient;
    if (!token) need(same(getCreate2Address({ from: c.positionForwarderFactory.address, salt: forwarderSalt, bytecodeHash: keccak256(creationCode) }), address), 'Forwarder factory CREATE2 identity differs');
    return { ...build, address, runtime, creationCode, transactionHash: log.transactionHash };
  });
}

async function ensurePublished(target, publish) {
  const url = `${SOURCIFY_BASE}/v2/contract/4663/${target.address}?fields=all`;
  async function read() {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' }, redirect: 'error' });
    if (response.status === 404) return null;
    need(response.ok, `Source readback unavailable (HTTP ${response.status})`);
    const bytes = await response.text(); need(Buffer.byteLength(bytes) <= 32 * 1024 * 1024, 'Source readback is too large');
    return validatePublished(target, JSON.parse(bytes));
  }
  const current = await read();
  if (current || !publish) return current ?? { role: target.role, address: target.address, status: 'not-published' };
  const response = await fetch(`${SOURCIFY_BASE}/v2/verify/4663/${target.address}`, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000), body: JSON.stringify({ stdJsonInput: target.input, compilerVersion: SOURCIFY_COMPILER, contractIdentifier: `${target.file}:${target.name}`, creationTransactionHash: target.transactionHash }) });
  need(response.status === 202, `Source publication rejected (HTTP ${response.status})`);
  const job = await response.json(); need(typeof job.verificationId === 'string', 'Missing source verification job');
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const result = await read(); if (result) return result;
    const { value } = await boundedPublicJson(`${SOURCIFY_BASE}/v2/verify/${job.verificationId}`);
    if (value.isJobCompleted) throw new Error(`${target.role}: source verification finished without a verified readback`);
  }
  throw new Error(`${target.role}: source verification is still pending; the checkpoint was not advanced`);
}

export async function run(options) {
  const release = JSON.parse(await readFile(path.join(ROOT, 'config/module-mode/robinhood.preview.json'), 'utf8'));
  need(release.chainId === 4663 && release.sourceVersion === 'module-native-v1' && release.enabled && release.status === 'active', 'An active native Module Mode release is required');
  const [chainId, finalized] = await rpcBatch([{ method: 'eth_chainId', params: [] }, { method: 'eth_getBlockByNumber', params: ['finalized', false] }]);
  need(BigInt(chainId) === 4663n && finalized?.number && finalized?.hash, 'Finalized Robinhood source unavailable');
  let checkpoint;
  if (options.stateFile) try { checkpoint = JSON.parse(await readFile(options.stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const range = scanRange(release, options, BigInt(finalized.number), checkpoint);
  if (checkpoint) {
    const [previous] = await rpcBatch([{ method: 'eth_getBlockByNumber', params: [toHex(range.from - 1n), false] }]);
    need(previous?.hash === checkpoint.blockHash, 'Checkpoint block is no longer canonical');
  }
  const report = { schemaVersion: 'programmable.module-mode-launch-source-report.v1', checkedAt: new Date().toISOString(), chainId: 4663, releaseDigest: release.releaseDigest, publish: options.publish, range, finalizedHash: finalized.hash, records: [] };
  if (range.from <= range.to) {
    const topics = [EVENT_TOPIC]; if (options.token) topics.push(null, null, `0x${word(options.token)}`);
    let [logs] = await rpcBatch([{ method: 'eth_getLogs', params: [{ address: release.contracts.launcher.address, fromBlock: toHex(range.from), toBlock: toHex(range.to), topics }] }]);
    need(Array.isArray(logs), 'Invalid launch log response');
    logs.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
    need(new Set(logs.map(log => `${log.blockHash}:${log.transactionHash}:${log.logIndex}`)).size === logs.length, 'Duplicate launch logs');
    need(logs.every(log => BigInt(log.blockNumber) >= range.from && BigInt(log.blockNumber) <= range.to), 'Launch log is outside the finalized scan range');
    if (options.token) need(logs.length === 1, 'Token does not have exactly one native launch in the scan range');
    logs = boundLaunchBatch(logs, range, options.maxLaunches);
    if (logs.length) {
      const roles = ['launcher', 'hook', 'tokenFactory', 'positionForwarderFactory', 'positionManager'];
      const code = await rpcBatch(roles.map(role => ({ method: 'eth_getCode', params: [release.contracts[role].address, 'latest'] })));
      const codes = Object.fromEntries(roles.map((role, i) => { need(keccak256(code[i]) === release.contracts[role].runtimeCodeHash, `Active ${role} code hash differs`); return [role, code[i]]; }));
      if (options.publish) await sourcifyPreflight();
      const builds = await templates(release, codes, options.solc);
      for (const log of logs) for (const target of await bindLaunch(release, log, builds)) report.records.push(await ensurePublished(target, options.publish));
    }
  }
  report.status = report.records.some(record => record.status === 'not-published') ? 'source-publication-required' : 'verified';
  if (options.stateFile && report.status === 'verified' && range.from <= range.to) {
    const [end] = await rpcBatch([{ method: 'eth_getBlockByNumber', params: [toHex(range.to), false] }]);
    need(end?.hash && BigInt(end.number) === range.to, 'Scan end block is unavailable');
    const next = { schemaVersion: STATE_SCHEMA, chainId: 4663, releaseDigest: release.releaseDigest, launcher: release.contracts.launcher.address, nextBlock: (range.to + 1n).toString(), blockHash: end.hash, checkedAt: report.checkedAt };
    await mkdir(path.dirname(path.resolve(options.stateFile)), { recursive: true });
    await writeFile(`${options.stateFile}.tmp`, `${json(next)}\n`); await rename(`${options.stateFile}.tmp`, options.stateFile);
  }
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
