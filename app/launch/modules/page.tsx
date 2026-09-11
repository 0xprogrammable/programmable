import type { Metadata } from "next";
import { ModuleModeLaunchHost } from "@/components/module-mode-launch-host";
import { ModuleEngineHost } from "@/components/module-engine-host";
import { readModuleEngineAvailability, readModuleEngineLaunchVersions } from "@/lib/server/module-engine/catalog";
import { parseModuleEngineAvailability } from "@/lib/module-engine/catalog";
import { isModuleEngineSharedQuoteRelease } from "@/lib/module-engine/profile";
import reviewedAnyQuoteRelease from "@/config/module-engine/review-release.json";
import { notFound } from "next/navigation";
import { parseModuleModePageSelection } from "@/lib/module-mode/release-selection";
import { readModuleModeLaunchVersions } from "@/lib/server/module-mode/launch-profiles";

export const metadata: Metadata = {
  title: "Module Mode · Programmable",
  description: "Create a meme coin, choose creator fees and configure optional modules on Robinhood.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/launch/modules" },
};

export default async function ModuleModePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let selection;
  try { selection = parseModuleModePageSelection(await searchParams); } catch { notFound(); }
  const [nativeVersions, engineVersions, currentEngine] = await Promise.allSettled([
    readModuleModeLaunchVersions(), readModuleEngineLaunchVersions(), readModuleEngineAvailability(reviewedAnyQuoteRelease.releaseDigest),
  ]);
  const versions = [nativeVersions, engineVersions].flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (selection.sourceKind === "module-engine-v1") return <ModuleEngineHost releaseDigest={selection.releaseDigest} versions={versions} />;
  let anyQuoteReleaseDigest;
  if (currentEngine.status === "fulfilled") {
    try {
      const { release, templates } = parseModuleEngineAvailability(currentEngine.value);
      // The review identity only selects the entry; current public authority must independently admit it.
      if (release && isModuleEngineSharedQuoteRelease(release) && release.releaseDigest === reviewedAnyQuoteRelease.releaseDigest
        && templates.some(template => template.manifest.manifest.catalogDefinition.interface === "quote-shared-v1")) anyQuoteReleaseDigest = release.releaseDigest;
    } catch { /* Unavailable or unbound engine sources never create a launch entry. */ }
  }
  return <ModuleModeLaunchHost releaseDigest={selection.releaseDigest} versions={versions} anyQuoteReleaseDigest={anyQuoteReleaseDigest} />;
}
