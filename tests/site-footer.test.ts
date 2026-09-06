import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const footerSource = readFileSync(
  new URL("../components/site-footer.tsx", import.meta.url),
  "utf8",
);
const footerStyles = readFileSync(
  new URL("../components/site-footer.module.css", import.meta.url),
  "utf8",
);

describe("Site footer", () => {
  it("keeps the landing footer frameless and links Explore to the directory", () => {
    expect(footerSource).toContain('href: "/explore"');
    expect(footerSource).toContain("data-site-footer");
    expect(footerSource).not.toContain("liquid-glass-surface");
  });

  it("links the public analytics shortcut from Resources", () => {
    expect(footerSource).toContain('href: "/analytics"');
    expect(footerSource).toContain('label: "Analytics"');
  });

  it("does not prefetch internal footer destinations, including the analytics redirect", () => {
    expect(footerSource.match(/prefetch=\{false\}/gu)).toHaveLength(3);
    expect(footerSource).toMatch(
      /className=\{styles\.brandLink\}[\s\S]{0,100}prefetch=\{false\}/u,
    );
    expect(footerSource).toContain(
      "<Link href={link.href} prefetch={false}>",
    );
  });

  it("links the official Discord from Resources", () => {
    expect(footerSource).toContain(
      'href: "https://discord.com/invite/programmable"',
    );
    expect(footerSource).toContain('label: "Discord"');
  });

  it("links the official X account from Resources", () => {
    expect(footerSource).toContain(
      'href: "https://x.com/ProgrammableHQ"',
    );
    expect(footerSource).toContain('label: "X"');
  });

  it("places Dune analytics between DEX Screener and Discord", () => {
    const dexscreener = footerSource.indexOf("https://dexscreener.com/");
    const dune = footerSource.indexOf(
      "https://dune.com/programmablehq/analytics",
    );
    const discord = footerSource.indexOf(
      "https://discord.com/invite/programmable",
    );

    expect(dexscreener).toBeGreaterThan(-1);
    expect(dune).toBeGreaterThan(dexscreener);
    expect(discord).toBeGreaterThan(dune);
    expect(footerSource).toContain('label: "DEX Screener"');
    expect(footerSource).toContain('label: "Dune analytics"');
  });

  it("stacks evenly aligned link groups on narrow screens", () => {
    expect(footerStyles).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(footerStyles).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.column ul\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    expect(footerStyles).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.brand\s*\{[^}]*justify-content:\s*space-between;/s,
    );
  });
});
