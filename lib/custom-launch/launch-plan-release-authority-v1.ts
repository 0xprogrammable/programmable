import { getAddress, sha256, toHex, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import type { LaunchPlanRecordV1 } from "./launch-plan-v1";
import { projectionAddress, projectionHash, projectionObject } from "./launch-projection-v1";

export type LaunchPlanStampBindingV1 = Readonly<{
  chainId: "4663"; manifestDigest: string; policyBindingHash: string;
  address: Address; runtimeCodeHash: Hex; permitAuthority: Address; permitAuthorityRuntimeCodeHash: Hex;
}>;
export type LaunchPlanPublicReleaseV1 = Readonly<{
  releaseId: string; manifestDigest: string; issuerVersion: string; binding: LaunchPlanStampBindingV1;
  execution: { stamp: { address: Address; runtimeCodeHash: Hex; selector: "0xbda52856" } };
  receiptIssuer: { keyId: string; publicKeyDigest: string; publicKey: string };
}>;
function fail(): never { throw new Error("The admission authority does not match this launch's original release. Refresh its wallet review."); }
const object = (value: unknown) => projectionObject(value) ? value : fail();
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(value);
const same = (a: unknown, b: unknown) => canonicalBrowserJsonV2(a) === canonicalBrowserJsonV2(b);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => same(Object.keys(value).sort(), [...expected].sort());

function base64(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail();
  try {
    const binary = atob(value);
    if (btoa(binary) !== value) fail();
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch { return fail(); }
}

function release(value: unknown): LaunchPlanPublicReleaseV1 {
  const entry = object(value), binding = object(entry.binding), stamp = object(object(entry.execution).stamp), issuer = object(entry.receiptIssuer);
  if (!digest(entry.releaseId) || !digest(entry.manifestDigest) || typeof entry.issuerVersion !== "string"
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.issuerVersion)
    || !keys(binding, ["chainId", "manifestDigest", "policyBindingHash", "address", "runtimeCodeHash", "permitAuthority", "permitAuthorityRuntimeCodeHash"])
    || binding.chainId !== "4663" || binding.manifestDigest !== entry.manifestDigest || !digest(binding.policyBindingHash)
    || !projectionAddress(binding.address) || !projectionAddress(binding.permitAuthority)
    || !projectionHash(binding.runtimeCodeHash) || !projectionHash(binding.permitAuthorityRuntimeCodeHash)
    || /^0x0{40}$/i.test(binding.address) || /^0x0{40}$/i.test(binding.permitAuthority)
    || /^0x0{64}$/.test(binding.runtimeCodeHash) || /^0x0{64}$/.test(binding.permitAuthorityRuntimeCodeHash)
    || !projectionAddress(stamp.address) || getAddress(stamp.address) !== getAddress(binding.address)
    || stamp.runtimeCodeHash !== binding.runtimeCodeHash || stamp.selector !== "0xbda52856"
    || typeof issuer.keyId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(issuer.keyId) || !digest(issuer.publicKeyDigest)) fail();
  const publicKey = base64(issuer.publicKey, 1024);
  if (`sha256:${sha256(toHex(publicKey)).slice(2)}` !== issuer.publicKeyDigest) fail();
  return entry as unknown as LaunchPlanPublicReleaseV1;
}

/** Select original authority from the source-bound inventory, independently of today's write mode.
 * An old record may not borrow the current release's key, runtime or policy. */
export async function verifyLaunchPlanReleaseAuthorityV1(resource: LaunchPlanRecordV1, capabilities: unknown,
  nowMilliseconds: number): Promise<LaunchPlanPublicReleaseV1> {
  const cap = object(capabilities), bindings = object(object(cap.availability).bindings);
  if (cap.schemaVersion !== "programmable.custom-launch-capabilities.v1" || cap.chainId !== "4663" || !digest(cap.manifestDigest)
    || !Array.isArray(bindings.releases) || bindings.releases.length < 1 || bindings.releases.length > 33
    || !Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) fail();
  const admission = resource.admission, evidence = resource.admissionEvidence;
  if (!admission || !evidence || !digest(evidence.policyBindingHash)) fail();
  const matches = bindings.releases.map(release).filter(entry => entry.manifestDigest === resource.manifestDigest
    && entry.receiptIssuer.keyId === admission.issuerKeyId && entry.issuerVersion === admission.issuerVersion
    && entry.binding.policyBindingHash === evidence.policyBindingHash);
  if (matches.length !== 1) fail();
  const selected = matches[0];
  const { receiptHash, signature, ...body } = admission;
  if (admission.schemaVersion !== "programmable.custom-launch-plan-admission.v1" || admission.planHash !== resource.planHash
    || admission.rawRequestSha256 !== resource.rawRequestSha256 || admission.manifestDigest !== resource.manifestDigest
    || admission.principalId !== resource.principalId || admission.chainId !== resource.plan.chainId
    || !projectionAddress(admission.controller) || getAddress(admission.controller) !== getAddress(resource.plan.controller.address)
    || !digest(receiptHash) || canonicalBrowserSha256V2("programmable.custom-launch-plan-admission.v1", body) !== receiptHash
    || admission.evidenceDigest !== canonicalBrowserSha256V2("programmable.custom-launch-plan-evidence.v1", evidence)
    || evidence.schemaVersion !== "programmable.custom-launch-plan-evidence.v1" || evidence.planHash !== resource.planHash
    || evidence.manifestDigest !== resource.manifestDigest
    || !Array.isArray(evidence.transactionDigests) || !same(evidence.transactionDigests, resource.steps.map(step => step.transactionDigest))
    || !same(resource.walletAuthorization ?? null, evidence.walletAuthorization ?? null)) fail();
  const issuedAt = Date.parse(admission.issuedAt), expiresAt = Date.parse(admission.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > nowMilliseconds
    || expiresAt <= nowMilliseconds || expiresAt - issuedAt > 300_000) {
    throw new Error("The launch admission has expired or is outside its valid time window. Refresh or replan before continuing.");
  }
  const publicKey = base64(selected.receiptIssuer.publicKey, 1024), signatureBytes = base64(signature, 128);
  if (signatureBytes.length !== 64) fail();
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify the launch admission signature.");
  try {
    const key = await crypto.subtle.importKey("spki", publicKey, "Ed25519", true, ["verify"]);
    if (toHex(new Uint8Array(await crypto.subtle.exportKey("spki", key))) !== toHex(publicKey)
      || !await crypto.subtle.verify("Ed25519", key, signatureBytes, new TextEncoder().encode(receiptHash))) fail();
  } catch { throw new Error("The launch admission signature could not be verified."); }
  return selected;
}
