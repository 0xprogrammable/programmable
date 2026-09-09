import type { Metadata } from "next";
import { DeveloperApiKeys } from "@/components/developer-api-keys";

export const metadata: Metadata = {
  title: "Build a custom hook · Programmable",
  description: "Give your AI builder an idea and an API key to build a custom hook project.",
  alternates: { canonical: "/developers/hooks" },
};

export default function CustomHookBuilderPage() {
  return <DeveloperApiKeys hookBuilder />;
}
