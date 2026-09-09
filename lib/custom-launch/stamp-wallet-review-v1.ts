import { decodeFunctionData, encodeFunctionData, getAddress, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { projectionObject } from "./launch-projection-v1";
import type { LaunchPlanRecordV1, LaunchWalletStepV1 } from "./launch-plan-v1";
import { CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, customLaunchPlanDigestBytesV1, customLaunchPlanLaunchIdV1,
  customLaunchPlanOccurrenceIdV1, customLaunchPlanStampComponentsHashV1, customLaunchPlanStampMarketsHashV1,
  customLaunchPlanStampPermitDigestV1, customLaunchPlanStampHashV1 } from "./stamp-plan-codec-v1";
import type { LaunchWalletProviderV1 } from "./wallet-handoff-plan-v1";
import type { LaunchPlanStampBindingV1 } from "./launch-plan-release-authority-v1";

const same = (a: unknown, b: unknown) => canonicalBrowserJsonV2(a) === canonicalBrowserJsonV2(b);
const wire = (value: unknown): unknown => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase()
  : Array.isArray(value) ? value.map(wire) : projectionObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)])) : value;
const sameWire = (a: unknown, b: unknown) => same(wire(a), wire(b));
const fail = (): never => { throw new Error("The stamp does not match this plan and its final controller evidence. Refresh the launch."); };
const object = (value: unknown) => projectionObject(value) ? value : fail();
const zero = `0x${"00".repeat(32)}`;

/** Decode every semantic root. The owner resource supplies protected source evidence,
 * while current RPC simulation verifies the released contract's permit and authority checks. */
export async function verifyStampWalletReviewV1(provider: LaunchWalletProviderV1, resource: LaunchPlanRecordV1,
  step: LaunchWalletStepV1, binding: LaunchPlanStampBindingV1, now: bigint) {
  const decoded = decodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, data: step.transaction.data });
  if (decoded.functionName !== "stampPlanV1" || encodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1,
    functionName: "stampPlanV1", args: decoded.args }) !== step.transaction.data || step.transaction.value !== "0") fail();
  const [permit, components, markets, signature] = decoded.args;
  const plan = resource.plan;
  const authorization = object(resource.walletAuthorization);
  const preparation = object(authorization.stampPreparation);
  const prefix = object(authorization.controllerPrefix);
  const prefixSteps = resource.steps.slice(0, resource.steps.indexOf(step));
  if (prefixSteps.some(item => item.status !== "final" || !item.transactionHash)
    || prefix.chainId !== plan.chainId || prefix.controller !== plan.controller.address.toLowerCase() || prefix.planHash !== resource.planHash
    || prefix.compilationDigest !== preparation.sourceEvidenceDigest
    || !same(prefix.steps, prefixSteps.map(item => ({ stepId: item.stepId, transactionDigest: item.transactionDigest, transactionHash: item.transactionHash })))
    || !Array.isArray(prefix.finality) || prefix.finality.length !== prefixSteps.length) fail();
  const expectedComponents = [];
  for (const component of plan.components) {
    const id = customLaunchPlanOccurrenceIdV1(resource.planHash, "component", component.componentId);
    const optional = plan.expectedEffects.some(effect => effect.kind === "child" && effect.componentId === component.componentId && effect.criticality !== "critical")
      && !plan.expectedEffects.some(effect => effect.kind === "child" && effect.componentId === component.componentId && effect.criticality === "critical");
    if (optional && !components.some(item => item.componentId === id)) {
      if (await provider.request({ method: "eth_getCode", params: [component.expectedAddress, "latest"] }) !== "0x") fail();
      continue;
    }
    expectedComponents.push({ componentId: id, account: getAddress(component.expectedAddress), runtimeCodeHash: component.runtimeCodeHash });
  }
  expectedComponents.sort((a, b) => a.componentId.localeCompare(b.componentId));
  const resolve = (ref: { address: `0x${string}` } | { componentId: string }) => getAddress("address" in ref ? ref.address
    : plan.components.find(item => item.componentId === ref.componentId)?.expectedAddress ?? fail());
  const expectedMarkets = plan.markets.map(market => ({ marketId: customLaunchPlanOccurrenceIdV1(resource.planHash, "market", market.marketId),
    poolManager: getAddress(market.poolManager), currency0: resolve(market.currency0), currency1: resolve(market.currency1),
    fee: market.fee, tickSpacing: market.tickSpacing, hooks: resolve(market.hooks) })).sort((a, b) => a.marketId.localeCompare(b.marketId));
  const wirePermit = { ...permit, chainId: permit.chainId.toString(), validAfter: permit.validAfter.toString(), deadline: permit.deadline.toString() };
  const preparationBinding = object(preparation.binding);
  if (permit.chainId !== 4663n || permit.stamp.toLowerCase() !== String(binding.address).toLowerCase()
    || permit.controller.toLowerCase() !== plan.controller.address.toLowerCase()
    || permit.controllerRuntimeCodeHash.toLowerCase() !== (plan.controller.kind === "eoa" ? zero : plan.controller.runtimeCodeHash?.toLowerCase())
    || permit.launchId !== customLaunchPlanLaunchIdV1(plan) || permit.planHash !== customLaunchPlanDigestBytesV1(resource.planHash)
    || permit.manifestDigest !== customLaunchPlanDigestBytesV1(resource.manifestDigest)
    || !sameWire(components, expectedComponents) || !sameWire(markets, expectedMarkets)
    || permit.componentsHash !== customLaunchPlanStampComponentsHashV1(components) || permit.marketsHash !== customLaunchPlanStampMarketsHashV1(markets)
    || permit.effectsHash !== customLaunchPlanDigestBytesV1(canonicalBrowserSha256V2("programmable.custom-launch-plan-effects.v1", plan.expectedEffects))
    || permit.feeObligationsHash !== customLaunchPlanDigestBytesV1(canonicalBrowserSha256V2("programmable.custom-launch-plan-fee-obligations.v1", plan.feeObligations))
    || permit.executionEvidenceHash !== customLaunchPlanDigestBytesV1(canonicalBrowserSha256V2("programmable.custom-launch-plan-controller-prefix.v1", prefix))
    || permit.executionEvidenceHash !== preparation.executionEvidenceHash || permit.nonce === zero || signature === "0x"
    || now < permit.validAfter || now >= permit.deadline || permit.validAfter < BigInt(plan.budgets.validAfter) || permit.deadline.toString() !== plan.budgets.deadline
    || !sameWire(wirePermit, preparation.permit) || !sameWire(components, preparation.components) || !sameWire(markets, preparation.markets)
    || customLaunchPlanStampPermitDigestV1(wirePermit) !== preparation.permitDigest
    || customLaunchPlanStampHashV1(preparation.permitDigest as Hex) !== preparation.stampHash
    || !sameWire(preparationBinding, binding) || binding.manifestDigest !== resource.manifestDigest
    || binding.policyBindingHash !== prefix.policyBindingHash) fail();
  return { functionName: decoded.functionName, permit: wirePermit, components, markets, permitDigest: preparation.permitDigest, stampHash: preparation.stampHash };
}
