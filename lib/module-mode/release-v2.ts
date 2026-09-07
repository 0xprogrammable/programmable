import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, rejectModuleEvidence, type ModuleModeReleaseV2 } from "./release";
export { MODULE_MODE_ECONOMICS_POLICY_V2, MODULE_MODE_RELEASE_SCHEMA_V2, MODULE_MODE_SOURCE_VERSION_V2, type ModuleModeReleaseV2 } from "./release";

/** The source-shared V2 normalizer uses the product's single release-identity implementation. */
export function bindActiveModuleModeReleaseV2(value: unknown): ModuleModeReleaseV2 {
  const release = bindActiveModuleModeRelease(value);
  if (release.sourceVersion !== "module-native-v2") rejectModuleEvidence("releaseV2.sourceVersion");
  return release;
}
export function computeModuleModeReleaseDigestV2(value: unknown) {
  const digest = computeModuleModeReleaseDigest(value);
  if ((value as { sourceVersion: unknown }).sourceVersion !== "module-native-v2") rejectModuleEvidence("releaseV2.sourceVersion");
  return digest;
}
