import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("launch model artwork", () => {
  const removedPartnerMarkers = [
    String.fromCharCode(97, 101, 111, 110, 102, 114, 97, 109, 101, 119, 111, 114, 107),
    ["based", "bidx"].join(""),
    `launch-model-${String.fromCharCode(97, 101, 111, 110)}`,
    `launch-model-${String.fromCharCode(98, 97, 115, 101, 100, 98, 105, 100)}`,
  ];

  it("uses the owned botanical art and exact Programmable loop asset", () => {
    const source = read("components/launch-entry.tsx");

    expect(source).toContain(
      'src="/brand/atmosphere/programmable-floral-hooks-v1.webp"',
    );
    expect(source).toContain(
      'src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"',
    );
    expect(source).toContain('calc((100vw - 96px) / 2), 624px');
    expect(source).not.toContain('calc((100vw - 96px) / 4), 260px');
    for (const marker of removedPartnerMarkers) {
      expect(source).not.toContain(marker);
    }
  });

  it("keeps model images stable on hover", () => {
    const source = read("components/launch-entry.tsx");
    const css = read("components/launch-experience.module.css");

    expect(css).not.toMatch(/:hover[^{}]*\.artImage\s*\{/s);
    expect(css).not.toMatch(/:hover[^{}]*\.modelArt img\s*\{/s);
    expect(source).not.toContain("onMouseEnter=");
    expect(source).not.toContain("onMouseLeave=");
    expect(source).toContain(
      "classicV3LaunchAvailable ? preloadAvailableForm : undefined",
    );
  });

  it("uses native card semantics and keeps decorative art out of the accessibility tree", () => {
    const source = read("components/launch-entry.tsx");
    const route = read("app/launch/page.tsx");

    expect(source).toContain('data-launch-model-option="classic"');
    expect(source).toContain('type="button"');
    expect(source).not.toContain('data-launch-model-option="prediction"');
    expect(source).toContain('data-launch-model-launchable="false"');
    expect(source).toContain(
      'aria-labelledby="launch-model-classic-title"',
    );
    expect(source).toContain(
      'aria-describedby={classicV3LaunchAvailable ? "launch-model-classic-description" : "launch-model-classic-description launch-model-classic-status"}',
    );
    expect(source).toContain(
      'aria-labelledby="launch-model-custom-title"',
    );
    expect(source).toContain(
      'aria-describedby="launch-model-custom-description"',
    );
    expect(source).toContain('data-launch-model-option="custom"');
    expect(source).toContain('data-launch-model-available="true"');
    expect(source).toContain('data-launch-model-entry="api-key-launch"');
    expect(source).toContain(
      'href="/developers/hooks"',
    );
    expect(source).not.toContain('onChoose("custom")');
    expect(source).not.toContain("customLaunchPublicEnabled");
    expect(source).not.toContain("custom-launch-experience");
    expect(source).not.toContain("custom-launch-local-preview");
    expect(route).toContain("return <LaunchExperience initialViewChainId={initialViewChainId} />;");
    expect(route).not.toContain("isCustomLaunchPublicEnabled");
    expect(route).not.toContain("configuredLaunchPermitSignersV2");
    for (const marker of removedPartnerMarkers) {
      expect(source).not.toContain(marker);
    }
    expect(source.match(/<LaunchArtworkImage \/>/g)).toHaveLength(2);
    expect(source.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain("launchExperience.predictionRail");
  });

  it("keeps decorative movement subtle and compositor-safe", () => {
    const css = read("components/launch-experience.module.css");
    const classicDrift = css.match(
      /@keyframes classic-botanical-drift[\s\S]*?(?=\n}\n\n@media)/,
    )?.[0];

    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain(
      "animation: classic-botanical-drift 12s steps(1, end) infinite",
    );
    expect(css).toContain("translate3d(0.06%, -0.03%, 0) scale(1.0012)");
    expect(classicDrift).not.toContain("filter:");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.classicArt \.artImage[\s\S]*?animation:\s*none;/,
    );
  });

  it("keeps the final Create hierarchy centered and the Classic controls neutral", () => {
    const css = read("components/launch-experience.module.css");

    expect(css).toMatch(
      /\/\* Create polish:[\s\S]*?\.pickerHeading\.pickerHeading\s*\{[\s\S]*?text-align:\s*center;/,
    );
    expect(css).toMatch(
      /\.pickerHeading\.pickerHeading h1\s*\{[\s\S]*?letter-spacing:\s*-0\.035em;[\s\S]*?line-height:\s*1;/,
    );
    expect(css).toContain(
      '.formPage.formPage[data-launch-model="classic-v3"]',
    );
    expect(css).toContain("--classic-control-surface: rgb(17 17 17 / 0.86)");
    expect(css).toContain("--classic-control-surface-selected: #242424");
    expect(css).toMatch(
      /\.formPage\.formPage\s+:global\(\.classic-launch-button\)\s*\{[\s\S]*?background:\s*#fff;[\s\S]*?color:\s*#000;/,
    );
  });

  it("loads the Classic module before replacing the picker", () => {
    const source = read("components/launch-entry.tsx");

    expect(source).toContain("const launchModule = await loadLaunchForm()");
    expect(source).toContain(
      "setLoadedLaunchBuilder(() => launchModule.LaunchBuilderForm)",
    );
    expect(source).toContain("if (!loadedLaunchBuilder) return null");
    expect(source).not.toContain(
      "<Suspense fallback={<LaunchFormLoading onBack={returnToModels} />}>",
    );
  });
});
