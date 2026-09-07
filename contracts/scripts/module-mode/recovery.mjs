import { canonicalJson, digest, hash, need } from './core.mjs';
import { observeStage, walletRequest } from './rpc.mjs';

/** An operator-only successor may continue the original journal, never change deployed bytes. */
export function assertContinuationPlan(original, current) {
  for (const plan of [original, current]) {
    const { planDigest, ...body } = plan;
    need(plan.sourceClean === true && digest(plan.schemaVersion, body) === hash(planDigest), 'Continuation requires intact clean-source plans');
    need(/^[a-f0-9]{40}$/.test(plan.sourceCommit) && /^[a-f0-9]{40}$/.test(plan.sourceTree), 'Invalid continuation source identity');
    need(plan.identityCandidate.sourceCommit === plan.sourceCommit, 'Continuation contract source differs');
  }
  const comparable = plan => {
    const body = Object.fromEntries(Object.entries(plan).filter(([key]) => !['sourceCommit', 'sourceTree', 'buildDigest', 'planDigest'].includes(key)));
    const inheritedBasisRequired = ['programmable.module-mode-native-v2-deployment-plan.v1', 'programmable.module-engine-deployment-plan.v1'].includes(plan.schemaVersion);
    need(!inheritedBasisRequired || plan.basis, 'Continuation requires the inherited source basis');
    if (plan.basis !== undefined) {
      const { basisDigest, ...basis } = plan.basis;
      need(inheritedBasisRequired
        && basis.schemaVersion === 'programmable.module-mode-native-v2-basis.v1'
        && digest(basis.schemaVersion, basis) === hash(basisDigest)
        && basis.provenance?.sourceCommit === plan.sourceCommit, 'Continuation basis domain, digest or source provenance differs');
      body.basis = { ...basis, provenance: { ...basis.provenance, sourceCommit: 'compared-separately' } };
    }
    return { ...body, identityCandidate: { ...body.identityCandidate, sourceCommit: 'compared-separately' } };
  };
  need(canonicalJson(comparable(original)) === canonicalJson(comparable(current)), 'Continuation changes deployment bytes, addresses, roles or economics');
  return original;
}

export function assertOriginalRequest(plan, entry, reviewedRequestDigest) {
  need(entry && !entry.transactionHash, 'Reconcile the recorded transaction before preparing any retry');
  need(entry.planDigest === plan.planDigest && plan.steps[entry.stepIndex], 'Retry journal belongs to another plan or step');
  const original = Object.fromEntries(['planDigest', 'stepIndex', 'request', 'observation', 'issuedAt', 'expiresAt'].map(key => [key, entry[key]]));
  need(digest('programmable.module-mode-owner-request.v1', original) === hash(entry.requestDigest), 'Original wallet request digest differs');
  need(entry.requestDigest === hash(reviewedRequestDigest), 'Explicitly reviewed original request digest required');
  return entry;
}

/** The original nonce and every wallet field are retained, including both fee caps and gas. */
export function walletRetryRequest(plan, entry, observation, ceilings, reviewedRequestDigest) {
  assertOriginalRequest(plan, entry, reviewedRequestDigest);
  need(observation.stepIndex === entry.stepIndex, 'Retry observation belongs to another step');
  const fresh = walletRequest(plan, observation, ceilings);
  need(fresh.nonce === entry.request.nonce, 'Original wallet nonce has changed; reconcile instead of retrying');
  need(BigInt(entry.request.gas) <= BigInt(ceilings.maxGas), 'Original request exceeds reviewed gas ceiling');
  need(BigInt(fresh.gas) <= BigInt(entry.request.gas), 'Fresh gas estimate exceeds the original request');
  need(BigInt(observation.minimumBalance) >= BigInt(entry.request.gas) * BigInt(entry.request.maxFeePerGas), 'Original request is no longer fully funded');
  need(canonicalJson({ ...fresh, gas: entry.request.gas }) === canonicalJson(entry.request), 'Retry would change the original wallet payload');
  return structuredClone(entry.request);
}

export async function prepareWalletRetry(plan, entry, providers, ceilings, reviewedRequestDigest, retryAttempt, stageObserver = observeStage) {
  need(Number.isSafeInteger(retryAttempt) && retryAttempt > 0, 'Explicit positive retry attempt required');
  assertOriginalRequest(plan, entry, reviewedRequestDigest);
  const observation = await stageObserver(plan, entry.stepIndex, providers);
  const request = walletRetryRequest(plan, entry, observation, ceilings, reviewedRequestDigest);
  const issuedAt = Date.now();
  const prepared = { planDigest: plan.planDigest, stepIndex: entry.stepIndex, request, observation,
    issuedAt, expiresAt: issuedAt + 300000, originalRequestDigest: entry.requestDigest, retryAttempt };
  return { ...prepared, requestDigest: digest('programmable.module-mode-owner-retry.v1', prepared) };
}
