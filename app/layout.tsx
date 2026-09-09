import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import {
  programmableSiteStructuredData,
  serializeStructuredData,
} from "@/lib/site-structured-data";
import "./globals.css";
import "./programmable-experience.css";
import "./interface.css";
import "./webde-final-ui.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

const siteUrl = new URL("https://programmable.market");
const siteDescription =
  "Build and launch custom Uniswap v4 hooks. Explore projects launched through Programmable.";
const socialImageUrl = new URL(
  "/og/programmable-landing-preview-v2-1200x630.jpg",
  siteUrl,
);

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "Programmable · Custom Uniswap v4 hooks",
  description: siteDescription,
  applicationName: "Programmable",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon-warm-ivory-v1.ico", sizes: "any" },
      {
        url: "/favicon-warm-ivory-v1-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/favicon-warm-ivory-v1-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/favicon-warm-ivory-v1-48x48.png",
        sizes: "48x48",
        type: "image/png",
      },
    ],
    shortcut: "/favicon-warm-ivory-v1.ico",
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Programmable",
    title: "Programmable · Custom Uniswap v4 hooks",
    description: siteDescription,
    images: [
      {
        url: socialImageUrl,
        secureUrl: socialImageUrl,
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: "Programmable over a vivid floral night garden",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Programmable · Custom Uniswap v4 hooks",
    description: siteDescription,
    creator: "@ProgrammableHQ",
    images: [
      {
        url: socialImageUrl,
        alt: "Programmable over a vivid floral night garden",
      },
    ],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme="dark">
      <head>
        <link
          href="/openapi.json"
          rel="service-desc"
          type="application/vnd.oai.openapi+json"
        />
        <link href="/agents.md" rel="help" type="text/markdown" title="Agent guide" />
        <script
          dangerouslySetInnerHTML={{
            __html: serializeStructuredData(programmableSiteStructuredData),
          }}
          type="application/ld+json"
        />
      </head>
      <body className={`${instrumentSans.variable} ${plexMono.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
