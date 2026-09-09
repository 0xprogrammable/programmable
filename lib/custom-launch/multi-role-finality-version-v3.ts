import { canonicalBrowserJsonV2 } from "./browser-authority-v2";
import { projectionObject } from "./launch-projection-v1";

/** Exact original-context selector from the historical MultiRole V3 contract.
 * This selects transaction tracking only; wallet/artifact V2 bytes stay intact. */
export const MULTI_ROLE_DERIVED_FINALITY_POLICY_V3 = Object.freeze({
  schemaVersion: "programmable.multi-role-derived-finality-policy.v3",
  evidenceSchemaVersion: "programmable.multi-role-finality-evidence.v3",
  bindingSchemaVersion: "programmable.multi-role-derived-contract-binding.v1",
  maximumDerivedContracts: 16,
});
export function multiRoleOriginalTransactionHintV3(resource: unknown) {
  if (!projectionObject(resource) || resource.schemaVersion !== "programmable.multi-role-custom-launch-resource.v2"
    || !projectionObject(resource.context) || !projectionObject(resource.context.profile)) {
    throw new Error("The original launch context is unavailable. Refresh transaction tracking.");
  }
  const profile = resource.context.profile;
  if (!Object.hasOwn(profile, "derivedContractFinality")) return {
    version: "v2", schemaVersion: "programmable.multi-role-transaction-hint.v2", path: "/transaction-hints",
  } as const;
  if (canonicalBrowserJsonV2(profile.derivedContractFinality) !== canonicalBrowserJsonV2(MULTI_ROLE_DERIVED_FINALITY_POLICY_V3)) {
    throw new Error("The original launch uses an unsupported finality contract. Refresh transaction tracking.");
  }
  return { version: "v3", schemaVersion: "programmable.multi-role-transaction-hint.v3", path: "/transaction-hints-v3" } as const;
}
