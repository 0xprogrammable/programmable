import type { ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import type { ModuleModeLaunchVersion } from "@/lib/module-mode/release-selection";
import { configuredModuleModeReleaseDigests, readModuleModeAvailability } from "./catalog";

/** The selector exposes only sources which passed the existing exact availability reader. */
export async function readModuleModeLaunchVersions(input: {
  digests: readonly string[];
  read: (digest: string) => Promise<ModuleModeAvailability>;
} = { digests: configuredModuleModeReleaseDigests(), read: readModuleModeAvailability }): Promise<ModuleModeLaunchVersion[]> {
  const digests = [...new Set(input.digests)];
  if (digests.length > 33 || digests.some(digest => !/^0x(?!0{64}$)[0-9a-f]{64}$/u.test(digest))) throw new Error("Invalid launch version inventory.");
  // The authority registry caps fanout; each reused reader coalesces I/O and enforces its own budget.
  const results = await Promise.allSettled(digests.map(async digest => input.read(digest)));
  return results.flatMap((result, index) => {
    const release = result.status === "fulfilled" ? result.value.release : null;
    return release?.releaseDigest === digests[index] ? [{ releaseDigest: release.releaseDigest,
      label: `Module ${release.sourceVersion === "module-native-v2" ? "v2" : "v1"} · ${release.releaseDigest.slice(2, 10)}` }] : [];
  });
}
