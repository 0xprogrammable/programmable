import type { NextConfig } from "next";

export function createContentSecurityPolicy(isDevelopment: boolean) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    [
      "script-src 'self' 'unsafe-inline'",
      isDevelopment ? "'unsafe-eval'" : "",
      "https://auth.privy.io",
      "https://*.privy.io",
      "https://challenges.cloudflare.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ].filter(Boolean).join(" "),
    "script-src-attr 'none'",
    [
      "style-src 'self' 'unsafe-inline'",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ].join(" "),
    "img-src 'self' blob: data: https:",
    "font-src 'self' data: https:",
    [
      "connect-src 'self' https: wss:",
      isDevelopment ? "http: ws:" : "",
    ].filter(Boolean).join(" "),
    [
      "frame-src 'self'",
      "https://dexscreener.com",
      "https://auth.privy.io",
      "https://*.privy.io",
      "https://verify.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://*.walletconnect.com",
      "https://*.walletconnect.org",
      "https://challenges.cloudflare.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ].join(" "),
    "worker-src 'self' blob:",
    "media-src 'self' blob: data: https:",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const contentSecurityPolicy = createContentSecurityPolicy(
  process.env.NODE_ENV === "development",
);

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Permissions-Policy",
    value: "browsing-topics=(), camera=(), geolocation=(), microphone=()",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
];

export const sharpRuntimeFiles = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/**/*",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/token-image": sharpRuntimeFiles,
    "/api/prediction/asset-logo/*": sharpRuntimeFiles,
    "/api/profile/projects/*/article/media": sharpRuntimeFiles,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/docs/developers/module-mode-indexing.md",
        destination: "/developers/module-mode-indexing-v1.md",
        permanent: false,
      },
      {
        source: "/docs/developers/custom-launch.md",
        destination: "/developers/custom-launch-api-v1.md",
        permanent: false,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.programmable.market" }],
        destination: "https://programmable.market/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/docs",
          destination: "https://proxy.gitbook.site/sites/site_V93gQ",
        },
        {
          source: "/docs/:match*",
          destination: "https://proxy.gitbook.site/sites/site_V93gQ/:match*",
        },
      ],
    };
  },
};

export default nextConfig;
