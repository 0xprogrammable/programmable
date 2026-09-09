import type { Metadata } from "next";

import { DeveloperApiKeys } from "@/components/developer-api-keys";
import { developerApiKeysInitialSection } from "@/lib/developer-api-key-route";
import { buildProgrammableAgentSetupTextV1 } from "@/lib/custom-launch/agent-setup-v1";
import { V4_API_PROFILE_VERSION } from "@/lib/custom-launch/v4-api-discovery";

export const metadata: Metadata = {
  title: "API keys · Programmable",
  description:
    "Create and manage API keys for custom hooks and module submissions.",
  alternates: {
    canonical: "/developers/api-keys",
  },
};

type DeveloperApiKeysSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function DeveloperApiKeysPage({
  searchParams,
}: Readonly<{ searchParams: DeveloperApiKeysSearchParams }>) {
  const resolvedSearchParams = await searchParams;
  return (
    <DeveloperApiKeys
      initialSection={developerApiKeysInitialSection(resolvedSearchParams)}
      moduleBuilder={resolvedSearchParams.purpose === "modules"}
      agentSetupText={buildProgrammableAgentSetupTextV1(V4_API_PROFILE_VERSION)}
    />
  );
}
