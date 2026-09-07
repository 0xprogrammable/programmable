import { bindActiveModuleModeRelease } from "./release";
import { normalizeModuleModeLaunches } from "./provenance";
import { normalizeModuleModeLaunchesV2 } from "./provenance-v2";

/** Only explicitly implemented source generations may interpret canonical launch evidence. */
export function normalizeSupportedModuleModeLaunches(evidence: readonly unknown[], profile: unknown) {
  const release = bindActiveModuleModeRelease(profile);
  return release.sourceVersion === "module-native-v1"
    ? normalizeModuleModeLaunches(evidence, release) : normalizeModuleModeLaunchesV2(evidence, release);
}
