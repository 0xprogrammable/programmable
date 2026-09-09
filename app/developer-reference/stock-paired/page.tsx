import type { Metadata } from "next";

import ModelDocsPage, {
  generateMetadata as generateModelMetadata,
} from "@/app/docs/models/[model]/page";

const modelParams = Promise.resolve({ model: "stock-paired" });

export async function generateMetadata(): Promise<Metadata> {
  return {
    ...await generateModelMetadata({ params: modelParams }),
    title: "Historical Stock-Paired · Programmable",
    alternates: { canonical: "/developer-reference/stock-paired" },
  };
}

export default function HistoricalStockPairedPage() {
  return ModelDocsPage({ params: modelParams });
}
