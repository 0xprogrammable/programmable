import test from 'node:test';
import assert from 'node:assert/strict';
import { plan as nativeV1 } from './test-fixtures.mjs';
import { digest } from './core.mjs';
import { sealBuild } from './build.mjs';
import { observeStage, observeReceipt, prepareWalletRequest, revalidateWalletRequest } from './rpc.mjs';
import { assertContinuationPlan, prepareWalletRetry } from './recovery.mjs';
import { operatorSourceProfile, startOperator } from './operator.mjs';
import { sealNativeV2Build } from '../module-native-v2/build.mjs';
import { assertNativeV2Basis } from '../module-native-v2/basis.mjs';
import { ECONOMICS_POLICY_ID } from '../module-native-v2/core.mjs';
import { observeNativeV2Stage, observeNativeV2Receipt } from '../module-native-v2/rpc.mjs';
import { sealEngineBuild } from '../module-engine/build.mjs';
import { observeEngineStage, observeEngineReceipt } from '../module-engine/rpc.mjs';

const schemas = { 'module-native-v2': ['programmable.module-mode-native-v2-deployment-plan.v1', 'programmable.module-mode-source.v2'],
  'module-engine-v1': ['programmable.module-engine-deployment-plan.v1', 'programmable.module-engine.release.v1'] };
function rehashPlan(plan) { const { planDigest, ...body } = plan; plan.planDigest = digest(plan.schemaVersion, body); return plan; }
function rehashBasis(plan) { const { basisDigest, ...body } = plan.basis; plan.basis.basisDigest = digest(plan.basis.schemaVersion, body); return rehashPlan(plan); }

// Synthetic dispatch/continuation fixtures only. The live operator always reconstructs every plan from its actual sealed build.
function planFor(sourceVersion) {
  const plan = structuredClone(nativeV1), [schemaVersion, identitySchema] = schemas[sourceVersion];
  plan.schemaVersion = schemaVersion;
  Object.assign(plan.identityCandidate, { schemaVersion: identitySchema, sourceVersion, economicsPolicyId: ECONOMICS_POLICY_ID });
  plan.economics.economicsPolicyId = ECONOMICS_POLICY_ID;
  plan.basis = { schemaVersion: 'programmable.module-mode-native-v2-basis.v1', chainId: 4663,
    provenance: { sourceCommit: plan.sourceCommit, files: { 'config/module-mode/robinhood.preview.json': { sha256: 'f'.repeat(64) } } },
    previousRelease: structuredClone(nativeV1.identityCandidate), registryOwner: plan.parameters.reviewAuthority,
    treasury: plan.economics.treasury, rewardAdmin: plan.economics.rewardAdmin };
  return rehashBasis(plan);
}

test('one operator selects exact source-specific sealers, authority bases, stage and receipt observers', () => {
  const v1 = operatorSourceProfile(nativeV1);
  assert.equal(v1.sealBuild, sealBuild); assert.equal(v1.observeStage, observeStage); assert.equal(v1.observeReceipt, observeReceipt);
  assert.equal(v1.assertBasis, undefined);
  for (const [version, sealer, stage, receipt] of [
    ['module-native-v2', sealNativeV2Build, observeNativeV2Stage, observeNativeV2Receipt],
    ['module-engine-v1', sealEngineBuild, observeEngineStage, observeEngineReceipt],
  ]) {
    const profile = operatorSourceProfile(planFor(version));
    assert.equal(profile.sourceVersion, version); assert.equal(profile.sealBuild, sealer);
    assert.equal(profile.observeStage, stage); assert.equal(profile.observeReceipt, receipt);
    assert.equal(profile.assertBasis, assertNativeV2Basis); assert.ok(Object.isFrozen(profile));
  }
});

test('mixed or unknown schemas, source versions, policies and continuation generations fail before operator startup', async () => {
  const plans = [nativeV1, planFor('module-native-v2'), planFor('module-engine-v1')];
  for (const a of plans) for (const b of plans) if (a !== b) {
    assert.throws(() => operatorSourceProfile({ ...a, identityCandidate: b.identityCandidate }), /mixed/);
    await assert.rejects(startOperator({ plan: a, continuationPlan: b, stepIndex: 0, uiCheck: true, port: 19787 }), /generation/);
  }
  for (const mutate of [
    p => { p.schemaVersion = 'future'; }, p => { p.identityCandidate.sourceVersion = 'module-native-v1'; },
    p => { p.identityCandidate.schemaVersion = 'programmable.module-mode-source.v1'; }, p => { p.chainId = 1; },
    p => { p.identityCandidate.chainId = 1; }, p => { p.sourceVersion = 'module-native-v1'; },
    p => { delete p.economics.economicsPolicyId; }, p => { p.identityCandidate.economicsPolicyId = nativeV1.planDigest; },
  ]) { const changed = planFor('module-engine-v1'); mutate(changed); assert.throws(() => operatorSourceProfile(changed), /schemas|chain|policy/); }
});

test('prepare, arm revalidation and explicit retry all bind the selected observer without changing wallet or digest rules', async () => {
  const ceilings = { maxGas: '12000000', maxFeePerGas: '100', maxPriorityFeePerGas: '1' };
  for (const version of Object.keys(schemas)) {
    const plan = planFor(version), providers = [], bindingKey = version === 'module-native-v2' ? 'nativeBindings' : 'engineBindings';
    let calls = 0, changed = false;
    const stageObserver = async (actualPlan, step, actualProviders) => {
      assert.equal(actualPlan, plan); assert.equal(step, 0); assert.equal(actualProviders, providers); calls++;
      if (changed) throw new Error('Bound inherited authority changed');
      return { state: 'vacant-simulated', stepIndex: 0, nonce: '3', minimumBalance: '1000000000000000000', baseFeePerGas: '10', gasLimit: '3000000',
        [bindingKey]: { economicsPolicyId: ECONOMICS_POLICY_ID, blockHash: plan.planDigest } };
    };
    const prepared = await prepareWalletRequest(plan, 0, providers, ceilings, stageObserver);
    const { requestDigest, ...body } = prepared;
    assert.equal(requestDigest, digest('programmable.module-mode-owner-request.v1', body));
    assert.deepEqual(prepared.observation[bindingKey], { economicsPolicyId: ECONOMICS_POLICY_ID, blockHash: plan.planDigest });
    const fresh = await revalidateWalletRequest(plan, prepared, providers, ceilings, stageObserver);
    assert.deepEqual(fresh, prepared.observation);
    const retry = await prepareWalletRetry(plan, prepared, providers, ceilings, prepared.requestDigest, 1, stageObserver);
    assert.deepEqual(retry.request, prepared.request); assert.equal(retry.originalRequestDigest, prepared.requestDigest);
    const { requestDigest: retryDigest, ...retryBody } = retry;
    assert.equal(retryDigest, digest('programmable.module-mode-owner-retry.v1', retryBody));
    await revalidateWalletRequest(plan, retry, providers, ceilings, stageObserver); assert.equal(calls, 4);
    changed = true;
    await assert.rejects(revalidateWalletRequest(plan, prepared, providers, ceilings, stageObserver), /authority changed/);
    await assert.rejects(prepareWalletRetry(plan, prepared, providers, ceilings, prepared.requestDigest, 2, stageObserver), /authority changed/);
  }
});

test('operator-only continuation permits the new bound basis commit and rejects rehashed provenance, rights or byte changes', () => {
  for (const version of Object.keys(schemas)) {
    const original = planFor(version), current = structuredClone(original);
    Object.assign(current, { sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40), buildDigest: nativeV1.planDigest });
    current.identityCandidate.sourceCommit = current.sourceCommit;
    current.basis.provenance.sourceCommit = current.sourceCommit; rehashBasis(current);
    assert.notEqual(current.planDigest, original.planDigest); assert.notEqual(current.basis.basisDigest, original.basis.basisDigest);
    assert.equal(assertContinuationPlan(original, current), original, 'Only source provenance changes; original journal remains authoritative');
    for (const mutate of [
      p => { p.basis.provenance.files['config/module-mode/robinhood.preview.json'].sha256 = '0'.repeat(64); },
      p => { p.basis.provenance.sourceCommit = 'e'.repeat(40); }, p => { p.basis.schemaVersion = 'other-basis-domain'; },
      p => { p.basis.registryOwner = p.parameters.owner; }, p => { p.basis.previousRelease.sourceVersion = 'module-native-v2'; },
      p => { p.steps[0].data += '00'; }, p => { p.economics.economicsPolicyId = nativeV1.planDigest; },
    ]) {
      const altered = structuredClone(current); mutate(altered); rehashBasis(altered);
      assert.throws(() => assertContinuationPlan(original, altered), /Continuation/);
    }
    const unbound = structuredClone(current); unbound.basis.basisDigest = nativeV1.planDigest; rehashPlan(unbound);
    assert.throws(() => assertContinuationPlan(original, unbound), /basis/);
    const missing = structuredClone(original); delete missing.basis; rehashPlan(missing);
    assert.throws(() => assertContinuationPlan(missing, missing), /basis/);
  }
});
