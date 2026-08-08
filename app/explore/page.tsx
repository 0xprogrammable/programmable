import type { Metadata } from "next";

import { ExploreView } from "@/components/explore-view";
import type { ExploreModelFilter } from "@/components/explore-view";

export const metadata: Metadata = {
  title: "Programmable",
  description: "Explore projects launched through Programmable.",
  alternates: {
    canonical: "/explore",
  },
};

export default async function ExplorePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ model?: string | string[] }>;
}>) {
  const requestedModel = (await searchParams).model;
  const initialModelFilter: ExploreModelFilter =
    requestedModel === "custom"
      ? "custom-hook"
      : requestedModel === "classic"
        ? "classic"
        : "all";

  return <ExploreView initialModelFilter={initialModelFilter} />;
}
