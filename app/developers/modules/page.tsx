import type { Metadata } from "next";
import { ModuleContributionEntry } from "@/components/module-contribution-entry";

export const metadata: Metadata = { title: "Build a module · Programmable", description: "Build and submit a reusable Module Mode module.", alternates: { canonical: "/developers/modules" } };

export default function ModuleContributionPage() { return <ModuleContributionEntry />; }
