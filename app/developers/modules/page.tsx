import type { Metadata } from "next";
import { DeveloperApiKeys } from "@/components/developer-api-keys";

export const metadata: Metadata = { title: "Build a module · Programmable", description: "Build and submit a reusable Module Mode module.", alternates: { canonical: "/developers/modules" } };

export default function ModuleContributionPage() { return <DeveloperApiKeys moduleBuilder />; }
