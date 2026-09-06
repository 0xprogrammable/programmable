import type { Metadata } from "next";
import { ModuleReviewAdminConsole } from "@/components/module-review-admin-console";

export const metadata: Metadata = {
  title: "Module review · Programmable",
  description: "Review module submissions and build evidence.",
  robots: { index: false, follow: false },
};

export default function ModuleReviewPage() {
  return <ModuleReviewAdminConsole />;
}
