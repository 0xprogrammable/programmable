import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("public shell polish", () => {
  it("keeps the 404 page concise and preserves both recovery actions", () => {
    const source = read("app/not-found.tsx");

    expect(source).toContain("This page isn’t available.");
    expect(source).not.toContain("404 · Page not found");
    expect(source).toContain("Explore projects");
    expect(source).toContain("Open docs");
    expect(source).toContain(
      "/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png",
    );
  });

  it("uses the branded shell for recoverable runtime errors", () => {
    const source = read("app/error.tsx");

    expect(source).toContain('"use client"');
    expect(source).toContain("Something went wrong.");
    expect(source).toContain("Check your wallet before repeating");
    expect(source).toContain("onClick={reset}");
    expect(source).toContain("Explore projects");
  });

  it("uses one aligned footer link set without duplicate social icons", () => {
    const source = read("components/site-footer.tsx");

    expect(source).toContain("<span>Programmable</span>");
    expect(source).toContain("© 2026 Programmable");
    expect(source).toContain('label: "GitHub"');
    expect(source).toContain('label: "X"');
    expect(source).toContain('label: "Token"');
    expect(source).not.toContain("XBrandIcon");
    expect(source).not.toContain("GitHubBrandIcon");
  });

  it("keeps route motion short, interruptible and compositor-friendly", () => {
    const source = read("components/route-transition.tsx");

    expect(source).toContain('"(prefers-reduced-motion: reduce)"');
    expect(source).toContain("routeAnimationRef.current?.cancel()");
    expect(source).toContain("translate3d(0, 3px, 0)");
    expect(source).toContain("duration: enteringDocs ? 120 : 160");
    expect(source).not.toContain("key={pathname}");
  });

  it("locks the public shell to the night atmosphere without a theme control", () => {
    const layout = read("app/layout.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(layout).toContain('colorScheme: "dark"');
    expect(layout).toContain('data-theme="dark"');
    expect(navigation).not.toContain("ThemeToggle");
    expect(navigation).not.toContain("activeThemeViewTransition");
  });

  it("avoids unbounded transitions in the owned style sheets", () => {
    const css = [
      read("app/globals.css"),
      read("app/not-found.module.css"),
      read("components/site-footer.module.css"),
    ].join("\n");

    expect(css).not.toMatch(/transition(?:-property)?:\s*all\b/);
  });
});
