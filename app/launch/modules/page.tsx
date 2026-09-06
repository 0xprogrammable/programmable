import type { Metadata } from "next";
import { ModuleModeLaunchHost } from "@/components/module-mode-launch-host";

export const metadata: Metadata = {
  title: "Module Mode · Programmable",
  description: "Create a meme coin, choose creator fees and configure optional modules on Robinhood.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/launch/modules" },
};

export default function ModuleModePage() {
  return <ModuleModeLaunchHost />;
}
