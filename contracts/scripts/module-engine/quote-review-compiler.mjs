import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { keccak256 } from 'viem';
import { canonicalJson, digest, need, sha256 } from '../module-mode/core.mjs';
import { repositoryState } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';

const exec = promisify(execFile);
export const QUOTE_REVIEW_SETTINGS = Object.freeze({ optimizer: { enabled: true, runs: 1000 }, evmVersion: 'cancun', viaIR: true, metadata: { bytecodeHash: 'none' } });
const PROFILE_FILE = 'lib/module-mode/review-engine-contract.ts';
const PLANNER_FILE = 'src/StockPairedPositionPlannerV3.sol', PLANNER = 'StockPairedPositionPlannerV3';
const ENGINE_FILE = 'src/module-engine/ModuleQuoteEngineV1.sol', ENGINE = 'ModuleQuoteEngineV1';
const SOLC_HASHES = new Set(['0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9', // pinned Darwin 0.8.26
  '35ba6661f3bdaed995fc7af14c405502290cf681b3fd062fe8738cfdf6db14ed']); // protected Linux review compiler
function literal(node) {
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(p => {
    need(ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)), 'Compiler settings must remain literal');
    return [p.name.text, literal(p.initializer)];
  }));
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  throw new Error('Compiler settings must remain literal');
}
export function quoteReviewSettings(source) {
  const file = ts.createSourceFile(PROFILE_FILE, source, ts.ScriptTarget.Latest, true), matches = [];
  for (const statement of file.statements) if (ts.isVariableStatement(statement)) for (const node of statement.declarationList.declarations)
    if (ts.isIdentifier(node.name) && node.name.text === 'NATIVE_SETTINGS_V1') matches.push(literal(node.initializer));
  need(matches.length === 1 && canonicalJson(matches[0]) === canonicalJson(QUOTE_REVIEW_SETTINGS), 'Actual Engine review compiler profile changed');
  return matches[0];
}
/** Preserve all source bytes. Alias source-unit names satisfy the original imports without compiler remappings. */
export function quoteReviewSources(input) {
  const sources = { ...input.sources };
  for (const mapping of input.settings.remappings ?? []) {
    const [prefix, target, surplus] = mapping.split('='); need(!surplus && prefix && target && !prefix.includes(':'), 'Unsupported source alias mapping');
    for (const [file, source] of Object.entries(input.sources)) if (file.startsWith(target)) {
      const alias = `${prefix}${file.slice(target.length)}`;
      need(!sources[alias] || sources[alias].content === source.content, 'Quote compiler source alias collision'); sources[alias] = source;
    }
  }
  need(Object.values(sources).reduce((n, source) => n + Buffer.byteLength(source.content), 0) <= 4 * 1024 * 1024, 'Quote source exceeds public review capacity');
  return Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
}
async function compile(binary, input) {
  const encoded = JSON.stringify(input); need(Buffer.byteLength(encoded) <= 5242880, 'Quote compiler input exceeds public review capacity');
  const raw = await new Promise((resolve, reject) => {
    const child = execFile(binary, ['--standard-json', '--no-import-callback'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', env: {} },
      (error, stdout) => error ? reject(new Error('Pinned Quote review-profile compilation failed')) : resolve(stdout));
    child.stdin.on('error', () => {}); child.stdin.end(encoded);
  });
  const output = exactJson(Buffer.from(raw), 'Quote compiler output');
  need(!(output.errors ?? []).some(error => error.severity === 'error'), `Quote review-profile compile failed: ${(output.errors ?? []).filter(e => e.severity === 'error').map(e => e.formattedMessage).join('\n')}`);
  return output;
}
function artifact(output, file, name) {
  const c = output.contracts?.[file]?.[name]; need(c?.evm && typeof c.metadata === 'string', 'Quote review artifact missing');
  const metadata = JSON.parse(c.metadata), bytecode = { object: `0x${c.evm.bytecode.object}`, linkReferences: c.evm.bytecode.linkReferences ?? {} },
    deployedBytecode = { object: `0x${c.evm.deployedBytecode.object}`, linkReferences: c.evm.deployedBytecode.linkReferences ?? {}, immutableReferences: c.evm.deployedBytecode.immutableReferences ?? {} };
  need(Object.keys(bytecode.linkReferences ?? {}).length === 0 && Object.keys(deployedBytecode.linkReferences ?? {}).length === 0, 'Quote review artifact has external library links');
  return { abi: c.abi, bytecode, deployedBytecode, immutableNames: {}, metadata, compilationTarget: metadata.settings.compilationTarget };
}
export async function bindQuoteReviewCompiler(build, root, environment = process.env) {
  const binary = environment.MODULE_MODE_SOLC; need(binary && path.isAbsolute(binary), 'Set MODULE_MODE_SOLC to the exact pinned native solc 0.8.26 binary');
  const binaryHash = sha256(await readFile(binary)).replace(/^sha256:|^0x/, ''); need(SOLC_HASHES.has(binaryHash), 'Quote compiler binary hash differs');
  const { stdout: version } = await exec(binary, ['--version'], { timeout: 10000, maxBuffer: 4096 });
  need(version.includes('Version: 0.8.26+commit.8a97fa7a'), 'Quote compiler version differs');
  const profileSource = await readFile(path.join(root, PROFILE_FILE), 'utf8');
  const { stdout: committedProfile } = await exec('git', ['show', `${build.sourceCommit}:${PROFILE_FILE}`], { cwd: root, maxBuffer: 1024 * 1024 });
  need(profileSource === committedProfile, 'Engine review compiler profile differs from committed source');
  const settings = quoteReviewSettings(profileSource), sources = quoteReviewSources(build.standardInputs.reviewEngine);
  const outputSelection = { [PLANNER_FILE]: { [PLANNER]: ['abi', 'metadata', 'evm.bytecode', 'evm.deployedBytecode'] },
    [ENGINE_FILE]: { [ENGINE]: ['abi', 'metadata', 'evm.bytecode', 'evm.deployedBytecode'] } };
  const expandedInput = { language: 'Solidity', sources, settings: { ...settings, outputSelection } }, expanded = await compile(binary, expandedInput);
  const expandedEngine = artifact(expanded, ENGINE_FILE, ENGINE), expandedPlanner = artifact(expanded, PLANNER_FILE, PLANNER);
  const actualSources = Object.fromEntries(Object.keys(expandedEngine.metadata.sources).sort().map(file => [file, sources[file]]));
  need(Object.keys(actualSources).length <= 128, 'Actual Quote source inventory exceeds transport file capacity');
  const input = { ...expandedInput, sources: actualSources }, output = await compile(binary, input);
  const planner = artifact(output, PLANNER_FILE, PLANNER), engine = artifact(output, ENGINE_FILE, ENGINE);
  need(canonicalJson(planner) === canonicalJson(expandedPlanner) && canonicalJson(engine) === canonicalJson(expandedEngine),
    'Removing unused source aliases changed the public Quote compiler artifacts');
  need(Object.keys(planner.deployedBytecode.immutableReferences ?? {}).length === 0, 'Quote planner cannot have unknown immutable bindings');
  const plannerRuntime = planner.deployedBytecode.object;
  need(engine.bytecode.object.includes(plannerRuntime.slice(2)), 'Quote Engine does not embed the exact Planner runtime');
  const creationBytes = (engine.bytecode.object.length - 2) / 2, runtimeBytes = (engine.deployedBytecode.object.length - 2) / 2;
  need(runtimeBytes <= 24576 && creationBytes + 640 <= 49152, 'Actual review-profile Quote Engine exceeds public runtime/initcode bounds');
  const plannerSources = Object.fromEntries(Object.keys(planner.metadata.sources).map(file => [file, sources[file]]));
  const plannerInput = { language: 'Solidity', sources: plannerSources, settings: { ...settings,
    outputSelection: { [PLANNER_FILE]: { [PLANNER]: ['abi', 'metadata', 'evm.bytecode', 'evm.deployedBytecode'] } } } };
  const isolated = artifact(await compile(binary, plannerInput), PLANNER_FILE, PLANNER);
  need(canonicalJson(isolated) === canonicalJson(planner), 'Planner standalone source publication differs from the Engine-embedded runtime');
  const after = await repositoryState(root); need(after.sourceCommit === build.sourceCommit && after.sourceTree === build.sourceTree
    && (!build.sourceClean || after.sourceClean), 'Source changed during Quote review compilation');
  const reviewCompilerParity = { schemaVersion: 'programmable.module-engine-quote-compiler-parity.v1', settings,
    profileSourceFile: PROFILE_FILE, profileSourceSha256: sha256(profileSource), compilerVersion: '0.8.26+commit.8a97fa7a', sourceFiles: Object.keys(actualSources).length,
    localCompilerBinarySha256: `sha256:${binaryHash}`, completeInputDigest: digest('programmable.module-engine-quote.compiler-input.v1', input),
    plannerRuntimeCodeHash: keccak256(plannerRuntime), plannerRuntimeEmbeddedInEngineCreation: true,
    engineCreationCodeHash: keccak256(engine.bytecode.object), engineRuntimeTemplateHash: keccak256(engine.deployedBytecode.object),
    engineCreationBytes: creationBytes, engineRuntimeBytes: runtimeBytes, canonicalConfigurationBytes: 384, boundEngineInitcodeBytes: creationBytes + 640,
    status: 'local-compiler-parity-not-accepted-source-review' };
  const commitments = { ...build.commitments, baseBuildDigest: build.buildDigest, reviewCompilerParity,
    artifacts: { ...build.commitments.artifacts, positionPlanner: digest('programmable.module-mode-build-artifact.v1', planner) } };
  return { ...build, artifacts: { ...build.artifacts, positionPlanner: planner },
    standardInputs: { ...build.standardInputs, positionPlanner: plannerInput }, compilerMetadata: { ...build.compilerMetadata, positionPlanner: planner.metadata },
    reviewCompilerInput: input, reviewCompilerParity, commitments, buildDigest: digest('programmable.module-engine-quote-build.v1', commitments) };
}
