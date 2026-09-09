import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ErrorPage from "../app/error";
import GlobalError from "../app/global-error";
import nextConfig, { createContentSecurityPolicy } from "../next.config";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

type ButtonElement = ReactElement<Readonly<{
  children?: ReactNode;
  onClick?: () => void;
}>>;

function findButton(node: ReactNode, label: string): ButtonElement | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Readonly<{ children?: ReactNode }>>;
  if (
    element.type === "button" &&
    Children.toArray(element.props.children).join("") === label
  ) {
    return element as ButtonElement;
  }
  for (const child of Children.toArray(element.props.children)) {
    const match = findButton(child, label);
    if (match) return match;
  }
  return null;
}

describe("website security headers", () => {
  it("applies the browser security policy to every route", async () => {
    const routes = await nextConfig.headers?.();

    expect(routes).toHaveLength(1);
    expect(routes?.[0]?.source).toBe("/:path*");

    const headers = new Map(
      routes?.[0]?.headers.map(({ key, value }) => [key, value]),
    );
    const policy = headers.get("Content-Security-Policy") ?? "";

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("img-src 'self' blob: data: https:");
    expect(policy).toContain("font-src 'self' data: https:");
    expect(policy).toContain("connect-src 'self' https: wss:");
    expect(policy).toContain("https://auth.privy.io");
    expect(policy).toContain("https://*.walletconnect.com");
    for (const directive of ["script-src", "style-src", "frame-src"]) {
      const value = policy.split("; ").find((candidate) =>
        candidate.startsWith(`${directive} `)
      );
      expect(value).toContain("https://hcaptcha.com");
      expect(value).toContain("https://*.hcaptcha.com");
    }
    expect(policy).toContain("worker-src 'self' blob:");

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("microphone=()");
  });

  it("allows development evaluation only in the development policy", () => {
    expect(createContentSecurityPolicy(false)).not.toContain("'unsafe-eval'");
    expect(createContentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });

  it("limits the market embed to its exact frame host without adding script access", () => {
    const policy = createContentSecurityPolicy(false).split("; ");
    const frame = policy.find((directive) => directive.startsWith("frame-src "));
    expect(frame).toContain("https://dexscreener.com");
    expect(frame).not.toContain("https://*.dexscreener.com");
    expect(policy.find((directive) => directive.startsWith("script-src "))).not.toContain("dexscreener");
  });
});

describe("application error boundaries", () => {
  it.each([
    ["page", ErrorPage],
    ["global", GlobalError],
  ] as const)(
    "uses Next data-aware retry in the %s boundary without exposing raw errors",
    (_name, Boundary) => {
      const retry = vi.fn();
      const tree = Boundary({
        error: Object.assign(new Error("private backend failure"), {
          digest: "opaque-reference",
        }),
        unstable_retry: retry,
      });
      const retryButton = findButton(tree, "Try again");

      expect(retryButton).not.toBeNull();
      retryButton?.props.onClick?.();
      expect(retry).toHaveBeenCalledOnce();

      const markup = renderToStaticMarkup(tree);
      expect(markup).toContain('role="alert"');
      expect(markup).toContain("Try again");
      expect(markup).toContain("Reload site");
      expect(markup).toContain("opaque-reference");
      expect(markup).not.toContain("private backend failure");
      expect(markup.toLowerCase()).not.toContain("oops");
    },
  );

  it("keeps keyboard, touch, reduced-motion and forced-color support", () => {
    const styles = read("app/error-boundary.module.css");

    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("min-height: 48px");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
  });
});
