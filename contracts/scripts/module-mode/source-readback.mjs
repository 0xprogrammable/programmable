import { getAddress, keccak256 } from 'viem';
import { parseStrictJson } from '../../../packages/launch/src/canonical-json.mjs';
import { decodeExactUtf8 } from '../../../packages/launch/src/io.mjs';
import { address, bytes, canonicalJson, hash, need } from './core.mjs';

export const SOURCIFY_BASE = 'https://sourcify.dev/server';
export const SOURCIFY_COMPILER = '0.8.26+commit.8a97fa7a';
export function exactJson(raw, label) {
  return parseStrictJson(decodeExactUtf8(raw, label), { maximumBytes: raw.length });
}
export async function boundedPublicJson(url, fetchImpl = fetch, maximumBytes = 32 * 1024 * 1024) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
  need(response.ok && response.headers.get('content-type')?.includes('application/json'), `Source API JSON unavailable (HTTP ${response.status})`);
  need(response.body, 'Source API response body unavailable');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) { total += chunk.length; need(total <= maximumBytes, 'Source API response too large'); chunks.push(chunk); }
  const raw = Buffer.concat(chunks); return { raw, value: exactJson(raw, 'Source API response') };
}
export async function sourcifyPreflight(fetchImpl = fetch) {
  const [api, chains] = await Promise.all([
    boundedPublicJson(`${SOURCIFY_BASE}/api-docs/swagger.json`, fetchImpl, 5 * 1024 * 1024),
    boundedPublicJson(`${SOURCIFY_BASE}/chains`, fetchImpl, 2 * 1024 * 1024),
  ]);
  need(api.value.info?.version === '2.1.0'
    && api.value.paths?.['/v2/verify/{chainId}/{address}']?.post?.responses?.['202']
    && api.value.paths?.['/v2/contract/{chainId}/{address}']?.get?.responses?.['200'], 'Sourcify V2 API changed');
  need(Array.isArray(chains.value), 'Sourcify chains response invalid');
  const chain = chains.value.filter(value => String(value.chainId) === '4663');
  need(chain.length === 1 && chain[0].name === 'Robinhood Chain' && chain[0].supported === true, 'Sourcify Robinhood support unavailable');
  return { provider: 'sourcify-v2', apiResponseBytesDigest: keccak256(api.raw), chainsResponseBytesDigest: keccak256(chains.raw) };
}
function equal(actual, expected, label) { need(canonicalJson(actual) === canonicalJson(expected), label); }
function empty(value, label) { need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0, label); }
function settings(value) {
  const result = Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => key !== 'outputSelection'));
  // Explicit false and omitted are the same two documented solc defaults. No other settings are discarded.
  if (result.viaIR === false) delete result.viaIR;
  if (result.metadata?.useLiteralContent === false) {
    result.metadata = { ...result.metadata }; delete result.metadata.useLiteralContent;
  }
  return result;
}
function abiEntries(value) {
  need(Array.isArray(value), 'ABI array required');
  const entries = value.map(canonicalJson).sort();
  need(new Set(entries).size === entries.length, 'Duplicate ABI entry');
  return entries;
}
export function sourcifyNeedsRecompilation(input, value) {
  return canonicalJson(settings(value.compilation?.compilerSettings)) !== canonicalJson(settings(input.settings));
}
function publicationSettings(input, value, artifact, recompilation, role) {
  const expected = settings(input.settings), actual = settings(value.compilation?.compilerSettings);
  equal(settings(value.stdJsonInput?.settings), actual, `${role}: Sourcify input/settings disagree`);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    // Sourcify deduplicates compilations by compiler/version and both bytecode hashes. This can retain
    // an older list of unused import remappings. Accept it only after an actual local recompilation.
    const withoutRemappings = settings => Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'remappings'));
    equal(withoutRemappings(actual), withoutRemappings(expected), `${role}: Sourcify compiler settings differ`);
    need(Array.isArray(actual.remappings) && actual.remappings.every(value => typeof value === 'string'), `${role}: invalid remappings`);
    need(recompilation?.compilerVersion === SOURCIFY_COMPILER
      && recompilation.inputDigest === keccak256(new TextEncoder().encode(canonicalJson(value.stdJsonInput)))
      && bytes(recompilation.creationBytecode) === bytes(artifact.bytecode.object)
      && bytes(recompilation.runtimeBytecode) === bytes(artifact.deployedBytecode.object), `${role}: pinned source recompilation required`);
    equal(abiEntries(recompilation.abi), abiEntries(artifact.abi), `${role}: recompiled ABI differs`);
  }
  equal({ ...value.stdJsonInput, settings: expected }, { ...input, settings: expected }, `${role}: Sourcify standard input differs`);
}

/** Independent complete-byte comparison. Provider `match` is preserved as such, never relabelled `exact_match`. */
export function validateSourcifySource({ plan, build, role, constructorArguments, creation, recompilation }, value) {
  const artifact = build.artifacts[role], pin = plan.contracts[role], input = build.standardInputs[role];
  need(artifact && pin && input, 'Unknown Sourcify target');
  const [file, name] = Object.entries(artifact.compilationTarget)[0];
  need(value?.chainId === '4663' && getAddress(value.address) === getAddress(pin.address), `${role}: Sourcify chain/address differs`);
  need(value.match === 'match' && value.creationMatch === 'match' && value.runtimeMatch === 'match', `${role}: Sourcify no-CBOR match is unavailable`);
  need(typeof value.matchId === 'string' && /^[1-9][0-9]*$/.test(value.matchId) && typeof value.verifiedAt === 'string'
    && Number.isFinite(Date.parse(value.verifiedAt)), `${role}: Sourcify match identity missing`);
  const compilation = value.compilation;
  need(compilation?.language === 'Solidity' && compilation.compiler === 'solc' && compilation.compilerVersion === SOURCIFY_COMPILER
    && compilation.name === name && compilation.fullyQualifiedName === `${file}:${name}`, `${role}: Sourcify compiler/target differs`);
  publicationSettings(input, value, artifact, recompilation, role);
  equal(value.sources, input.sources, `${role}: Sourcify source closure differs`);
  equal(value.metadata, build.compilerMetadata?.[role] ?? artifact.metadata, `${role}: Sourcify full compiler metadata differs`);
  // ABI item order has no semantic meaning; argument, tuple and output order remain exact.
  equal(abiEntries(value.abi), abiEntries(artifact.abi), `${role}: Sourcify ABI differs`);
  need(value.deployment?.transactionHash === hash(creation.transactionHash)
    && BigInt(value.deployment.blockNumber) === BigInt(creation.blockNumber)
    && BigInt(value.deployment.transactionIndex) === BigInt(creation.transactionIndex)
    && address(value.deployment.deployer) === address(creation.transactionSender), `${role}: Sourcify actual creation transaction differs`);
  const c = value.creationBytecode, r = value.runtimeBytecode;
  need(c && r, `${role}: Sourcify creation/runtime bytes unavailable`);
  const compiledCreation = bytes(artifact.bytecode.object), compiledRuntime = bytes(artifact.deployedBytecode.object);
  const onchainCreation = `${compiledCreation}${constructorArguments.slice(2)}`;
  need(bytes(c.recompiledBytecode) === compiledCreation && bytes(c.onchainBytecode) === onchainCreation
    && bytes(r.recompiledBytecode) === compiledRuntime && bytes(r.onchainBytecode) === pin.runtime, `${role}: complete creation/runtime bytes differ`);
  for (const [label, code] of [['creation', c], ['runtime', r]]) {
    empty(code.cborAuxdata, `${role}: unexpected ${label} CBOR transformation`);
    empty(code.linkReferences, `${role}: unexpected ${label} library link`);
  }
  const expectedCreationTransforms = constructorArguments === '0x' ? [] : [{ type: 'insert', offset: (compiledCreation.length - 2) / 2, reason: 'constructorArguments' }];
  equal(c.transformations, expectedCreationTransforms, `${role}: creation transformation differs`);
  equal(c.transformationValues, constructorArguments === '0x' ? {} : { constructorArguments }, `${role}: constructor transformation differs`);
  const compiledRefs = artifact.deployedBytecode.immutableReferences ?? {}, refs = r.immutableReferences ?? {};
  // AST numeric ids are local to the compilation's source unit set. All byte offsets/lengths must still match.
  const ranges = value => Object.values(value).flat().sort((a, b) => a.start - b.start || a.length - b.length);
  equal(ranges(refs), ranges(compiledRefs), `${role}: immutable reference offsets differ`);
  const transforms = Object.entries(refs).flatMap(([id, list]) => list.map(ref => ({ id, type: 'replace', offset: ref.start, reason: 'immutable' })));
  const sort = list => [...list].sort((a, b) => a.offset - b.offset || String(a.id).localeCompare(String(b.id)));
  need(Array.isArray(r.transformations), `${role}: runtime transformations missing`);
  equal(sort(r.transformations), sort(transforms), `${role}: runtime transformations differ`);
  const immutableValues = {};
  for (const [id, list] of Object.entries(refs)) {
    need(list.length > 0, `${role}: empty immutable reference`);
    for (const ref of list) {
      const actual = `0x${pin.runtime.slice(2 + ref.start * 2, 2 + (ref.start + ref.length) * 2)}`;
      need(ref.length === 32 && actual.length === 66 && (!immutableValues[id] || immutableValues[id] === actual), `${role}: inconsistent immutable value`);
      immutableValues[id] = actual;
    }
  }
  equal(r.transformationValues, transforms.length ? { immutables: immutableValues } : {}, `${role}: runtime immutable values differ`);
  return { role, address: pin.address, runtimeCodeHash: pin.runtimeCodeHash, constructorArguments,
    sourcePaths: Object.keys(input.sources).sort(), sourceCommit: plan.sourceCommit, provider: 'sourcify-v2',
    providerMatch: value.match, creationMatch: value.creationMatch, runtimeMatch: value.runtimeMatch,
    providerClassification: 'NO_CBOR_PROVIDER_MATCH', independentByteComparison: 'exact-complete-creation-and-runtime',
    transformationPolicy: 'constructor-arguments-and-compiled-immutables-only', creationTransactionHash: creation.transactionHash,
    creationBytecodeHash: keccak256(onchainCreation), recompiledRuntimeCodeHash: keccak256(compiledRuntime),
    matchId: value.matchId, verifiedAt: value.verifiedAt };
}
