import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeAbiParameters, encodeFunctionData, getContractAddress, keccak256, parseAbi, stringToHex } from 'viem';
import { canonicalJson } from '../../../src/index.mjs';
import { validateModuleSubmissionRequest } from '../../../src/open-transport.mjs';
import { CONFIGURATION_ABI, encodeSettlementConfiguration } from './config-codec.mjs';
import { checkBuild, starterRoot } from './check-build.mjs';

// These are service-owned Anvil fixture identities. They never replace descriptor.author/rewardWallet.
export const FIXTURE = Object.freeze({
  chainId: 31337n,
  creator: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  user: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  host: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  beneficiary: '0x0000000000000000000000000000000000003003',
  token: '0x0000000000000000000000000000000000001001',
  firstQuote: '0x0000000000000000000000000000000000001002',
  secondQuote: '0x0000000000000000000000000000000000002002',
  refundAfter: 1800003700,
});
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const UINT = [{ type: 'uint256' }];
export const CONTEXT_ABI = [
  { name: 'host', type: 'address' }, { name: 'launchId', type: 'bytes32' },
  { name: 'token', type: 'address' }, { name: 'creator', type: 'address' },
  { name: 'quoteAsset', type: 'address' }, { name: 'feeCollector', type: 'address' },
];
const CONSTRUCTOR_ABI = [{ type: 'tuple', components: CONTEXT_ABI }, { type: 'bytes' }];
const READS = parseAbi([
  'function totalLiability() view returns(uint256)',
  'function requests(bytes32) view returns(address payer,address beneficiary,uint256 amount,uint256 refundAfter,bytes32 obligationHash,uint8 status)',
]);
const hashText = (text) => keccak256(stringToHex(text));
const reviewDigest = (domain, value) => `0x${createHash('sha256').update(canonicalJson({ domain, value })).digest('hex')}`;
const abi = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values);
const ids = { request: hashText('settlement.request.v1'), fulfill: hashText('settlement.fulfill.v1'), refund: hashText('settlement.refund.v1') };
const obligation = hashText('local fixture: fixed delivery obligation');
const evidence = hashText('local fixture: creator attestation, not an oracle');

/** Materializes one operator-proposed plan; it neither approves nor uploads a plan to the service. */
export function materializePlan(request, artifact, submissionId) {
  assert.match(submissionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  const checked = validateModuleSubmissionRequest(request);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  const descriptor = checked.request.descriptor;
  assert.deepEqual(descriptor.components, [{ id: 'engine', runtime: 'programmable.module-engine-solidity@1',
    sourcePath: 'src/QuoteBoundSettlementV1.sol', entrypoint: 'QuoteBoundSettlementV1' }]);
  assert.deepEqual(artifact.deployedBytecode.immutableReferences || {}, {});
  for (const [path, source] of Object.entries(artifact.metadata.sources)) {
    const file = checked.request.files.find((candidate) => candidate.path === path);
    assert.ok(file, `Compiler dependency missing from submission: ${path}`);
    assert.equal(keccak256(Buffer.from(file.bytes, 'base64')), source.keccak256, `Compiler/source mismatch: ${path}`);
  }
  const fixed = descriptor.configuration.fields.quoteAsset.binding?.mode === 'fixed';
  const quote = fixed ? encodeSettlementConfiguration(descriptor.configuration, {}).normalized.quoteAsset : FIXTURE.firstQuote;
  assert.ok(![ZERO, FIXTURE.token, FIXTURE.host, FIXTURE.creator, FIXTURE.user, FIXTURE.beneficiary].includes(quote),
    'Choose a quote distinct from the service-owned fixture accounts/token');
  const otherQuote = quote === FIXTURE.secondQuote ? FIXTURE.firstQuote : FIXTURE.secondQuote;
  const contextFor = (id, quoteAsset) => ({
    host: FIXTURE.host,
    launchId: reviewDigest('programmable.modules.engine-review-launch.v1', { requestDigest: checked.requestDigest, caseId: id }),
    token: FIXTURE.token, creator: FIXTURE.creator, quoteAsset, feeCollector: FIXTURE.host,
  });
  const resources = (quoteAsset) => keccak256(abi(['address', 'address', 'uint256', 'uint256'], [quoteAsset, FIXTURE.creator, 60n, 2592000n]));
  const readRequest = (requestId, amount, status) => ({
    callData: encodeFunctionData({ abi: READS, functionName: 'requests', args: [requestId] }),
    expectedData: abi(['address', 'address', 'uint256', 'uint256', 'bytes32', 'uint8'],
      [FIXTURE.user, FIXTURE.beneficiary, amount, BigInt(FIXTURE.refundAfter), obligation, status]),
  });
  const liability = (amount) => ({
    callData: encodeFunctionData({ abi: READS, functionName: 'totalLiability' }), expectedData: encodeAbiParameters(UINT, [amount]),
  });
  function successfulCase(id, quoteAsset) {
    const parameters = fixed ? {} : { quoteAsset };
    const config = encodeSettlementConfiguration(descriptor.configuration, parameters).encoded;
    const context = contextFor(id, quoteAsset);
    const constructorArgs = encodeAbiParameters(CONSTRUCTOR_ABI, [context, config]);
    const initCodeHash = keccak256(`${artifact.bytecode.object}${constructorArgs.slice(2)}`);
    const engine = getContractAddress({ from: FIXTURE.host, opcode: 'CREATE2', salt: context.launchId, bytecodeHash: initCodeHash });
    const requestId = (nonce) => keccak256(abi(['uint256', 'address', 'bytes32', 'address', 'address', 'uint256'],
      [FIXTURE.chainId, FIXTURE.host, context.launchId, engine, FIXTURE.user, nonce]));
    const first = requestId(0n), second = requestId(1n);
    const base = (name, operationId, actor, timestamp) => ({
      id: name, actor, timestamp, operationId, recipient: FIXTURE.user,
      inputAsset: ZERO, inputAmount: '0', outputAsset: ZERO, minimumOutput: '0',
      data: '0x', expectedOutcome: 'success', expectedResult: '0x', assertions: [],
    });
    const requestOperation = (name, amount, requestId, total) => ({
      ...base(name, ids.request, 'user', 1800000100), inputAsset: quoteAsset, inputAmount: String(amount),
      data: abi(['address', 'uint256', 'bytes32'], [FIXTURE.beneficiary, BigInt(FIXTURE.refundAfter), obligation]),
      expectedResult: abi(['bytes32'], [requestId]), assertions: [liability(total), readRequest(requestId, amount, 1)],
    });
    const close = (name, requestId, fulfill, amount, timestamp) => ({
      ...base(name, fulfill ? ids.fulfill : ids.refund, fulfill ? 'creator' : 'user', timestamp),
      recipient: fulfill ? FIXTURE.beneficiary : FIXTURE.user, outputAsset: quoteAsset, minimumOutput: String(amount),
      data: fulfill ? abi(['bytes32', 'bytes32'], [requestId, evidence]) : abi(['bytes32'], [requestId]),
      expectedResult: abi(['bytes32', 'uint8'], [requestId, fulfill ? 2 : 3]),
    });
    const rejected = (op, total, extra = {}) => ({ ...op, ...extra, expectedOutcome: 'revert', expectedResult: '0x', assertions: [liability(total)] });
    return {
      id, parameters, token: FIXTURE.token, quoteAsset, launchData: '0x', expectedResourcesHash: resources(quoteAsset),
      expectedDeployment: 'success', operations: [
        requestOperation('request-for-fulfillment', 100n, first, 100n),
        requestOperation('request-for-refund', 200n, second, 300n),
        rejected(close('reject-foreign-fulfillment', first, true, 100n, 1800000200), 300n, { actor: 'user' }),
        rejected(close('reject-redirected-fulfillment', first, true, 100n, 1800000200), 300n, { recipient: FIXTURE.user }),
        { ...close('fulfill-bound-beneficiary', first, true, 100n, 1800000200), assertions: [liability(200n), readRequest(first, 100n, 2)] },
        rejected(close('reject-early-refund', second, false, 200n, 1800000200), 200n),
        rejected(close('reject-refund-after-fulfillment', first, false, 100n, FIXTURE.refundAfter), 200n),
        rejected(close('reject-expired-fulfillment', second, true, 200n, FIXTURE.refundAfter), 200n),
        rejected(close('reject-foreign-refund', second, false, 200n, FIXTURE.refundAfter), 200n, { actor: 'creator' }),
        { ...close('refund-original-payer', second, false, 200n, FIXTURE.refundAfter), assertions: [liability(0n), readRequest(second, 200n, 3)] },
        rejected(close('reject-double-refund', second, false, 200n, FIXTURE.refundAfter), 0n),
      ],
    };
  }
  const negative = (id, quoteAsset, parameters, rawConfigBytes) => ({
    id, parameters, token: FIXTURE.token, quoteAsset, launchData: '0x', expectedResourcesHash: ZERO_HASH,
    expectedDeployment: 'revert', operations: [], ...(rawConfigBytes === undefined ? {} : { rawConfigBytes }),
  });
  const plan = {
    schemaVersion: 'programmable.modules.engine-build-plan.v1', submissionId, requestDigest: checked.requestDigest,
    engineComponentId: 'engine', configurationCodec: 'programmable.engine-abi@1', configurationAbi: CONFIGURATION_ABI,
    immutableBindings: [],
    operationPermissions: [
      { operationId: ids.request, inputRoles: 2, outputRoles: 0, authorization: 0 },
      { operationId: ids.fulfill, inputRoles: 0, outputRoles: 2, authorization: 1 },
      { operationId: ids.refund, inputRoles: 0, outputRoles: 2, authorization: 0 },
    ],
    moneyRights: 2, coinRights: 0,
    // Hermetic host economics, not a claim that this nontrade engine charges swap fees or earns rewards.
    testEconomics: { platformBps: 30, buyCreatorBps: 0, sellCreatorBps: 0 }, executionGas: 500000,
    cases: [
      successfulCase('first-quote-settlement', quote),
      ...(fixed ? [] : [successfulCase('second-quote-same-source', otherQuote)]),
      negative('reject-context-quote-mismatch', otherQuote, fixed ? {} : { quoteAsset: quote }),
      negative('reject-raw-fixed-window-override', quote, {}, abi(['address', 'uint256', 'uint256'], [quote, 61n, 2592000n])),
    ],
  };
  return { plan, packageId: checked.packageId, familyId: checked.familyId, requestDigest: checked.requestDigest };
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--request', '--submission-id', '--out'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')
      || Object.hasOwn(options, flag)) throw new Error(`Unknown, repeated or incomplete option: ${flag}`);
    options[flag] = args[++i];
  }
  if (Object.keys(options).length !== 3) throw new Error('Use --request FILE --submission-id UUID --out FILE');
  const request = JSON.parse(await readFile(resolve(options['--request']), 'utf8'));
  const { artifact } = await checkBuild(starterRoot);
  const result = materializePlan(request, artifact, options['--submission-id']);
  await writeFile(resolve(options['--out']), `${JSON.stringify(result.plan, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ packageId: result.packageId, familyId: result.familyId, requestDigest: result.requestDigest,
    cases: result.plan.cases.length, planAssigned: false, reviewApproved: false, available: false }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
