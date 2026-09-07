import type { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Documentation · Programmable",
  description:
    "Product, token, infrastructure and developer documentation for Programmable on Robinhood Chain and Ethereum.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <div data-docs-font>{children}</div>;
}
