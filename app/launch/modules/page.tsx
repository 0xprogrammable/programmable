import type { Metadata } from "next";
import { ModuleModeLaunchHost } from "@/components/module-mode-launch-host";
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
  if (selection.sourceKind) notFound();
  const versions = await readModuleModeLaunchVersions().catch(() => []);
  return <ModuleModeLaunchHost releaseDigest={selection.releaseDigest} versions={versions} />;
}
