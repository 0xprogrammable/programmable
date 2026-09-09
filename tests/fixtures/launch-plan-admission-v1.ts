import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { encodeFunctionData, type Address } from "viem";
import { canonicalBrowserSha256V2 as digest } from "@/lib/custom-launch/browser-authority-v2";
import type { LaunchAdmissionReceiptV1, LaunchPlanRecordV1 } from "@/lib/custom-launch/launch-plan-v1";
import type { LaunchPlanPublicReleaseV1, LaunchPlanStampBindingV1 } from "@/lib/custom-launch/launch-plan-release-authority-v1";
import { CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, customLaunchPlanStampComponentsHashV1, customLaunchPlanStampMarketsHashV1,
  customLaunchPlanStampPermitDigestV1, customLaunchPlanStampHashV1, customLaunchPlanDigestBytesV1,
  customLaunchPlanLaunchIdV1, customLaunchPlanOccurrenceIdV1, type CustomLaunchPlanStampPermitV1 } from "@/lib/custom-launch/stamp-plan-codec-v1";
import { bindStep, component, controller, hash, now, nowIso, recordFixture, runtimeHash, stamp } from "./universal-launch-v1";

// Ephemeral keys exist only in Node tests. The browser fixtures never import this module.
export function admissionIssuerFixture(keyId = "fixture-admission-issuer") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bytes = publicKey.export({ type: "spki", format: "der" });
  return { privateKey, public: { keyId, publicKey: bytes.toString("base64"),
    publicKeyDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` } };
}
export const issuerFixture = admissionIssuerFixture();
export const fixtureIssuerVersion = "a".repeat(40);
export const policyFixture = digest("programmable.custom-launch-plan-policy-binding.v1", { fixture: true });
export function stampBindingFixture(record: LaunchPlanRecordV1, policyBindingHash: string = policyFixture): LaunchPlanStampBindingV1 {
  return { chainId: "4663", manifestDigest: record.manifestDigest, policyBindingHash, address: stamp, runtimeCodeHash: runtimeHash,
    permitAuthority: "0x5555555555555555555555555555555555555555" as Address, permitAuthorityRuntimeCodeHash: runtimeHash };
}
export function authorizeRecordFixture(record: LaunchPlanRecordV1, overrides: Partial<Omit<LaunchAdmissionReceiptV1, "receiptHash" | "signature">> = {}, issuer = issuerFixture): LaunchPlanRecordV1 {
  const admissionEvidence = { ...record.admissionEvidence, schemaVersion: "programmable.custom-launch-plan-evidence.v1",
    planHash: record.planHash, manifestDigest: record.manifestDigest, policyBindingHash: record.admissionEvidence?.policyBindingHash ?? policyFixture,
    transactionDigests: record.steps.map(step => step.transactionDigest) };
  const body = { schemaVersion: "programmable.custom-launch-plan-admission.v1" as const, planHash: record.planHash,
    rawRequestSha256: record.rawRequestSha256, manifestDigest: record.manifestDigest, principalId: record.principalId,
    controller: record.plan.controller.address, chainId: record.plan.chainId,
    evidenceDigest: digest("programmable.custom-launch-plan-evidence.v1", admissionEvidence), issuerVersion: fixtureIssuerVersion,
    issuerKeyId: issuer.public.keyId, issuedAt: nowIso, expiresAt: new Date(Number(now + 300n) * 1000).toISOString(),
    assuranceClaims: record.admission?.assuranceClaims ?? [], ...overrides };
  const receiptHash = digest("programmable.custom-launch-plan-admission.v1", body);
  return { ...record, admissionEvidence, admission: { ...body, receiptHash, signature: sign(null, Buffer.from(receiptHash, "utf8"), issuer.privateKey).toString("base64") } };
}
export function releaseFixture(record: LaunchPlanRecordV1, issuer = issuerFixture): LaunchPlanPublicReleaseV1 {
  const binding = stampBindingFixture(record, String(record.admissionEvidence?.policyBindingHash ?? policyFixture));
  return { releaseId: digest("programmable.custom-launch-plan-release.v1", { manifestDigest: record.manifestDigest, keyId: issuer.public.keyId }),
    manifestDigest: record.manifestDigest, issuerVersion: record.admission!.issuerVersion, binding,
    execution: { stamp: { address: binding.address, runtimeCodeHash: binding.runtimeCodeHash, selector: "0xbda52856" } }, receiptIssuer: issuer.public };
}
export function capabilitiesFixture(record: LaunchPlanRecordV1, releases = [releaseFixture(record)], current = releases[0]) {
  const disabled = { state: "disabled", reasons: ["PLAN_OPERATION_DISABLED"] };
  const active = { state: "active", reasons: [] };
  return { schemaVersion: "programmable.custom-launch-capabilities.v1", chainId: "4663", manifestDigest: current.manifestDigest,
    availability: { state: "disabled", manifestDigest: current.manifestDigest,
      operations: { preflight: active, create: disabled, replan: disabled, read: active, proofs: active },
      bindings: { execution: current.execution, receiptIssuer: current.receiptIssuer, releases } } };
}

export function stampRecordFixture(): LaunchPlanRecordV1 {
  const base = recordFixture();
  const first = { ...base.steps[0], status: "final" as const, transactionHash: hash };
  const controllerPrefix = { chainId: "4663", controller, planHash: base.planHash, compilationDigest: base.planHash, policyBindingHash: policyFixture,
    steps: [{ stepId: first.stepId, transactionDigest: first.transactionDigest, transactionHash: first.transactionHash }], finality: [{ fixture: true }] };
  const components = [{ componentId: customLaunchPlanOccurrenceIdV1(base.planHash, "component", "settlement"), account: component, runtimeCodeHash: runtimeHash }];
  const permit: CustomLaunchPlanStampPermitV1 = { chainId: "4663", stamp, controller, controllerRuntimeCodeHash: `0x${"00".repeat(32)}`,
    launchId: customLaunchPlanLaunchIdV1(base.plan), planHash: customLaunchPlanDigestBytesV1(base.planHash), manifestDigest: customLaunchPlanDigestBytesV1(base.manifestDigest),
    componentsHash: customLaunchPlanStampComponentsHashV1(components), marketsHash: customLaunchPlanStampMarketsHashV1([]),
    effectsHash: customLaunchPlanDigestBytesV1(digest("programmable.custom-launch-plan-effects.v1", base.plan.expectedEffects)),
    feeObligationsHash: customLaunchPlanDigestBytesV1(digest("programmable.custom-launch-plan-fee-obligations.v1", base.plan.feeObligations)),
    executionEvidenceHash: customLaunchPlanDigestBytesV1(digest("programmable.custom-launch-plan-controller-prefix.v1", controllerPrefix)),
    nonce: hash, validAfter: now.toString(), deadline: base.plan.budgets.deadline };
  const permitDigest = customLaunchPlanStampPermitDigestV1(permit);
  const stampPreparation = { permit, components, markets: [], permitDigest, stampHash: customLaunchPlanStampHashV1(permitDigest),
    executionEvidenceHash: permit.executionEvidenceHash, sourceEvidenceDigest: base.planHash, binding: stampBindingFixture(base) };
  const walletAuthorization = { stampPreparation, controllerPrefix };
  const data = encodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_STAMP_ABI_V1, functionName: "stampPlanV1",
    args: [{ ...permit, chainId: 4663n, validAfter: now, deadline: BigInt(permit.deadline) }, components, [], "0x11"] });
  const last = bindStep({ ...base.steps[0], stepId: "stamp", actionIds: ["platform:stampPlanV1"], postconditions: [], transaction: { ...base.steps[0].transaction, to: stamp, data } });
  return authorizeRecordFixture({ ...base, steps: [first, last], walletAuthorization,
    admissionEvidence: { walletAuthorization } } as unknown as LaunchPlanRecordV1);
}
